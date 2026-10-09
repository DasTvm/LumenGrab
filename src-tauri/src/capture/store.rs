//! The one active capture session: frozen frames of every display (and the window list) while the
//! overlays are open. At most one at a time; dropped on finish or cancel to release the memory.

use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};

use super::{encode, CaptureMode, DisplayInfo, Frame, WindowInfo};

pub struct SessionDisplay {
    pub info: DisplayInfo,
    pub frame: Frame,
    png: Mutex<Option<Arc<Vec<u8>>>>,
}

impl SessionDisplay {
    pub fn new(info: DisplayInfo, frame: Frame) -> Self {
        Self {
            info,
            frame,
            png: Mutex::new(None),
        }
    }

    /// The frozen frame as a fast-encoded PNG, encoded on first use and cached.
    pub fn png(&self) -> Option<Arc<Vec<u8>>> {
        let mut slot = self.png.lock().ok()?;
        if slot.is_none() {
            *slot = Some(Arc::new(
                encode::encode_png(&self.frame, encode::Profile::Fast).ok()?,
            ));
        }
        slot.clone()
    }
}

pub struct Session {
    pub id: String,
    /// When the hotkey was handled; used to log hotkey-to-overlay latency.
    pub started: Instant,
    /// The mode the capture started in.
    pub mode: CaptureMode,
    /// The mode the overlays are in right now: the capture bar switches it for all displays at once.
    live_mode: Mutex<CaptureMode>,
    /// Whether the capture bar (mode switcher) is shown. Quick shortcuts start without it.
    pub toolbar: bool,
    /// The display the capture bar and the hint live on: the one under the cursor at the start.
    /// Only one display shows them, so there is never a second, out-of-sync bar.
    pub home_display: u32,
    pub displays: Vec<SessionDisplay>,
    /// Front to back. Empty unless `mode` is `Window`.
    pub windows: Vec<WindowInfo>,
}

impl Session {
    pub fn new(
        id: String,
        started: Instant,
        mode: CaptureMode,
        toolbar: bool,
        home_display: u32,
        displays: Vec<SessionDisplay>,
        windows: Vec<WindowInfo>,
    ) -> Self {
        Self {
            id,
            started,
            mode,
            live_mode: Mutex::new(mode),
            toolbar,
            home_display,
            displays,
            windows,
        }
    }

    pub fn live_mode(&self) -> CaptureMode {
        *self.live_mode.lock().expect("mode lock")
    }

    pub fn set_live_mode(&self, mode: CaptureMode) {
        *self.live_mode.lock().expect("mode lock") = mode;
    }

    pub fn display(&self, id: u32) -> Option<&SessionDisplay> {
        self.displays.iter().find(|d| d.info.id == id)
    }
}

#[derive(Default)]
struct Inner {
    /// True from the moment a capture starts until it is finished, so key repeat and double
    /// presses cannot start a second one while the first is still freezing displays.
    busy: bool,
    /// Reserved id of a session whose frames are still being captured (overlays may already ask for it).
    pending: Option<String>,
    session: Option<Arc<Session>>,
}

#[derive(Default)]
pub struct CaptureStore {
    inner: Mutex<Inner>,
    counter: AtomicU64,
}

impl CaptureStore {
    /// Claims the store for a new capture. `false` if one is already running.
    pub fn try_begin(&self) -> bool {
        let mut g = self.inner.lock().expect("store lock");
        if g.busy {
            return false;
        }
        g.busy = true;
        true
    }

    pub fn next_id(&self) -> String {
        format!("s{}", self.counter.fetch_add(1, Ordering::Relaxed) + 1)
    }

    /// Reserves an id for a capture that is still freezing displays, so overlay windows can already
    /// be created and ask for it (`is_pending`) while the frames are captured.
    pub fn reserve(&self) -> String {
        let id = self.next_id();
        self.inner.lock().expect("store lock").pending = Some(id.clone());
        id
    }

    /// Id of the capture in progress (still freezing, or with overlays up), if any.
    pub fn active_id(&self) -> Option<String> {
        let g = self.inner.lock().expect("store lock");
        g.pending
            .clone()
            .or_else(|| g.session.as_ref().map(|s| s.id.clone()))
    }

    pub fn is_pending(&self, id: &str) -> bool {
        self.inner.lock().expect("store lock").pending.as_deref() == Some(id)
    }

    pub fn publish(&self, session: Session) -> Arc<Session> {
        let session = Arc::new(session);
        let mut g = self.inner.lock().expect("store lock");
        g.pending = None;
        g.session = Some(session.clone());
        session
    }

    pub fn get(&self, id: &str) -> Option<Arc<Session>> {
        self.inner
            .lock()
            .expect("store lock")
            .session
            .clone()
            .filter(|s| s.id == id)
    }

    /// Ends the capture (also when it never got a session). Returns the session if `id` matched.
    pub fn finish(&self, id: Option<&str>) -> Option<Arc<Session>> {
        let mut g = self.inner.lock().expect("store lock");
        match (id, g.session.as_ref()) {
            (Some(want), Some(have)) if have.id != want => None, // stale request for an old session
            _ => {
                g.busy = false;
                g.pending = None;
                g.session.take()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::{NativeRect, PxRect};

    fn session(store: &CaptureStore) -> Session {
        let info = DisplayInfo {
            id: 1,
            name: "d".into(),
            native: NativeRect {
                x: 0.0,
                y: 0.0,
                width: 2.0,
                height: 2.0,
            },
            pixel_width: 2,
            pixel_height: 2,
            scale: 1.0,
            is_primary: true,
        };
        let frame = Frame {
            width: 2,
            height: 2,
            rgba: vec![9; 16],
        };
        let _ = PxRect {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
        };
        Session::new(
            store.next_id(),
            Instant::now(),
            CaptureMode::Area,
            true,
            1,
            vec![SessionDisplay::new(info, frame)],
            vec![],
        )
    }

    #[test]
    fn only_one_capture_at_a_time() {
        let store = CaptureStore::default();
        assert!(store.try_begin());
        assert!(
            !store.try_begin(),
            "key repeat must not start a second capture"
        );
        store.finish(None);
        assert!(store.try_begin());
    }

    #[test]
    fn stale_ids_do_not_end_the_current_session() {
        let store = CaptureStore::default();
        assert!(store.try_begin());
        let s = store.publish(session(&store));
        assert!(store.get(&s.id).is_some());
        assert!(store.get("s999").is_none());
        assert!(store.finish(Some("s999")).is_none());
        assert!(!store.try_begin(), "still busy after a stale finish");
        assert!(store.finish(Some(&s.id)).is_some());
        assert!(store.get(&s.id).is_none());
        assert!(store.try_begin());
    }

    #[test]
    fn reserved_id_is_pending_until_published_or_finished() {
        let store = CaptureStore::default();
        assert!(store.try_begin());
        let id = store.reserve();
        assert!(store.is_pending(&id));
        assert!(
            store.get(&id).is_none(),
            "not usable before the frames exist"
        );
        let s = Session {
            id: id.clone(),
            ..session(&store)
        };
        store.publish(s);
        assert!(!store.is_pending(&id));
        assert!(store.get(&id).is_some());
        // Cancelled while still pending.
        store.finish(None);
        assert!(store.try_begin());
        let id2 = store.reserve();
        store.finish(Some(&id2));
        assert!(!store.is_pending(&id2));
    }

    #[test]
    fn the_live_mode_starts_as_the_start_mode_and_can_be_switched() {
        let store = CaptureStore::default();
        let s = session(&store);
        assert_eq!(s.live_mode(), CaptureMode::Area);
        s.set_live_mode(CaptureMode::Window);
        assert_eq!(s.live_mode(), CaptureMode::Window);
        assert_eq!(s.mode, CaptureMode::Area, "the start mode is kept");
    }

    #[test]
    fn png_is_encoded_once_and_cached() {
        let store = CaptureStore::default();
        let d = &session(&store).displays[0].info.clone();
        let sd = SessionDisplay::new(
            d.clone(),
            Frame {
                width: 2,
                height: 2,
                rgba: vec![9; 16],
            },
        );
        let a = sd.png().unwrap();
        let b = sd.png().unwrap();
        assert!(Arc::ptr_eq(&a, &b));
        assert_eq!(&a[1..4], b"PNG");
    }
}
