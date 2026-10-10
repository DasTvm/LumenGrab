//! Where the Quick Access windows go. Pure geometry, so it is unit tested without a display.
//!
//! The cards stack in one corner of a monitor's **work area** (the screen without menu bar, Dock or
//! taskbar). Card sizes are logical pixels; the work area and the result are physical pixels, and
//! `scale` converts between them, so the same code serves macOS (points) and Windows (pixels).
//!
//! Every card lives in its own transparent window that is larger than the card: the extra room (the
//! "pad") holds the soft shadow and, while hovering, a tooltip above or a hint below the card.
//! Between two cards the pads are only half the gap, so neighbouring windows never overlap (on
//! Windows a transparent window still swallows clicks).

use crate::settings::Corner;

/// Distance between the card and the screen edge.
pub const MARGIN: f64 = 16.0;
/// Distance between two stacked cards.
pub const GAP: f64 = 8.0;
/// Room for the shadow beside the card.
pub const PAD_SIDE: f64 = 24.0;
/// Room above the card when nothing is stacked above it.
pub const PAD_TOP: f64 = 8.0;
/// Room below the card when nothing is stacked below it (the shadow falls downwards).
pub const PAD_BOTTOM: f64 = 24.0;

/// The usable part of one monitor, in physical pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// A card as the web page measured it, in logical pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CardBox {
    pub width: f64,
    pub height: f64,
    /// Extra room above the card for a tooltip, only while one is showing.
    pub extra_top: f64,
    /// Extra room below the card for a hint, only while one is showing.
    pub extra_bottom: f64,
}

/// Room around the card inside its window, in logical pixels.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
pub struct Pad {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

/// A window rectangle in physical pixels, plus the pad the page must leave around the card.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Placed {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub pad: Pad,
}

fn px(logical: f64, scale: f64) -> u32 {
    (logical * scale).round().max(1.0) as u32
}

/// Positions for a stack of cards; `cards[0]` is the newest and sits in the corner, the others
/// follow away from it.
pub fn stack(corner: Corner, work: WorkArea, scale: f64, cards: &[CardBox]) -> Vec<Placed> {
    let work_w = f64::from(work.width) / scale;
    let work_h = f64::from(work.height) / scale;
    let bottom = matches!(corner, Corner::BottomLeft | Corner::BottomRight);
    let right = matches!(corner, Corner::TopRight | Corner::BottomRight);

    // Where the next card's edge nearest the corner is, relative to the work area, logical.
    let mut edge = if bottom { work_h - MARGIN } else { MARGIN };
    let mut placed = Vec::with_capacity(cards.len());
    for (i, card) in cards.iter().enumerate() {
        let top_edge = if bottom { edge - card.height } else { edge };
        let has_card_above = if bottom { i + 1 < cards.len() } else { i > 0 };
        let has_card_below = if bottom { i > 0 } else { i + 1 < cards.len() };
        let pad = Pad {
            top: if has_card_above { GAP / 2.0 } else { PAD_TOP } + card.extra_top,
            right: PAD_SIDE,
            bottom: if has_card_below {
                GAP / 2.0
            } else {
                PAD_BOTTOM
            } + card.extra_bottom,
            left: PAD_SIDE,
        };
        let win_w = card.width + pad.left + pad.right;
        let win_h = card.height + pad.top + pad.bottom;
        let rel_x = if right {
            work_w - MARGIN + PAD_SIDE - win_w
        } else {
            MARGIN - PAD_SIDE
        };
        placed.push(Placed {
            x: work.x + (rel_x * scale).round() as i32,
            y: work.y + ((top_edge - pad.top) * scale).round() as i32,
            width: px(win_w, scale),
            height: px(win_h, scale),
            pad,
        });
        edge = if bottom {
            top_edge - GAP
        } else {
            top_edge + card.height + GAP
        };
    }
    placed
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORK: WorkArea = WorkArea {
        x: 0,
        y: 0,
        width: 1440,
        height: 900,
    };

    fn card(h: f64) -> CardBox {
        CardBox {
            width: 340.0,
            height: h,
            extra_top: 0.0,
            extra_bottom: 0.0,
        }
    }

    /// The card's own rectangle (window minus pad), logical, relative to the work area origin.
    fn card_rect(p: &Placed, scale: f64, work: WorkArea) -> (f64, f64, f64, f64) {
        (
            f64::from(p.x - work.x) / scale + p.pad.left,
            f64::from(p.y - work.y) / scale + p.pad.top,
            f64::from(p.width) / scale - p.pad.left - p.pad.right,
            f64::from(p.height) / scale - p.pad.top - p.pad.bottom,
        )
    }

    #[test]
    fn one_card_sits_16_px_from_the_bottom_right_corner() {
        let p = &stack(Corner::BottomRight, WORK, 1.0, &[card(72.0)])[0];
        assert_eq!(
            card_rect(p, 1.0, WORK),
            (1440.0 - 16.0 - 340.0, 900.0 - 16.0 - 72.0, 340.0, 72.0)
        );
    }

    #[test]
    fn the_other_corners_mirror_it() {
        let c = &[card(72.0)];
        let tl = card_rect(&stack(Corner::TopLeft, WORK, 1.0, c)[0], 1.0, WORK);
        assert_eq!(tl, (16.0, 16.0, 340.0, 72.0));
        let tr = card_rect(&stack(Corner::TopRight, WORK, 1.0, c)[0], 1.0, WORK);
        assert_eq!(tr, (1440.0 - 16.0 - 340.0, 16.0, 340.0, 72.0));
        let bl = card_rect(&stack(Corner::BottomLeft, WORK, 1.0, c)[0], 1.0, WORK);
        assert_eq!(bl, (16.0, 900.0 - 16.0 - 72.0, 340.0, 72.0));
    }

    #[test]
    fn bottom_corners_stack_upwards_with_an_8_px_gap_newest_in_the_corner() {
        let cards = [card(72.0), card(100.0), card(72.0)];
        let placed = stack(Corner::BottomRight, WORK, 1.0, &cards);
        let rects: Vec<_> = placed.iter().map(|p| card_rect(p, 1.0, WORK)).collect();
        assert_eq!(rects[0].1, 900.0 - 16.0 - 72.0);
        assert_eq!(
            rects[1].1 + rects[1].3 + 8.0,
            rects[0].1,
            "8 px above the newest"
        );
        assert_eq!(rects[2].1 + rects[2].3 + 8.0, rects[1].1);
    }

    #[test]
    fn top_corners_stack_downwards() {
        let cards = [card(72.0), card(100.0)];
        let placed = stack(Corner::TopLeft, WORK, 1.0, &cards);
        let rects: Vec<_> = placed.iter().map(|p| card_rect(p, 1.0, WORK)).collect();
        assert_eq!(rects[0].1, 16.0);
        assert_eq!(rects[1].1, 16.0 + 72.0 + 8.0);
    }

    #[test]
    fn neighbouring_windows_never_overlap() {
        for corner in [
            Corner::TopLeft,
            Corner::TopRight,
            Corner::BottomLeft,
            Corner::BottomRight,
        ] {
            let placed = stack(corner, WORK, 1.0, &[card(72.0), card(315.0), card(72.0)]);
            let mut spans: Vec<(i32, i32)> = placed
                .iter()
                .map(|p| (p.y, p.y + p.height as i32))
                .collect();
            spans.sort_unstable();
            for pair in spans.windows(2) {
                assert!(pair[0].1 <= pair[1].0, "{corner:?}: {spans:?}");
            }
        }
    }

    #[test]
    fn a_tooltip_grows_the_window_upwards_only() {
        let plain = stack(Corner::BottomRight, WORK, 1.0, &[card(72.0)])[0];
        let with_tip = stack(
            Corner::BottomRight,
            WORK,
            1.0,
            &[CardBox {
                extra_top: 44.0,
                ..card(72.0)
            }],
        )[0];
        assert_eq!(with_tip.y, plain.y - 44);
        assert_eq!(with_tip.height, plain.height + 44);
        assert_eq!(with_tip.x, plain.x);
        assert_eq!(
            card_rect(&with_tip, 1.0, WORK),
            card_rect(&plain, 1.0, WORK),
            "the card itself does not move"
        );
    }

    #[test]
    fn retina_scale_keeps_logical_distances_in_physical_pixels() {
        let work = WorkArea {
            x: 0,
            y: 50,
            width: 2880,
            height: 1700,
        };
        let p = &stack(Corner::BottomRight, work, 2.0, &[card(72.0)])[0];
        let (x, y, w, h) = card_rect(p, 2.0, work);
        assert_eq!((w, h), (340.0, 72.0));
        assert_eq!(x, 1440.0 - 16.0 - 340.0);
        assert_eq!(y, 850.0 - 16.0 - 72.0);
    }

    #[test]
    fn a_monitor_left_of_and_above_the_primary_has_negative_coordinates() {
        let work = WorkArea {
            x: -1920,
            y: -200,
            width: 1920,
            height: 1080,
        };
        let p = &stack(Corner::TopLeft, work, 1.0, &[card(72.0)])[0];
        assert_eq!(card_rect(p, 1.0, work), (16.0, 16.0, 340.0, 72.0));
        assert!(p.x < 0 && p.y < 0, "{p:?}");
    }

    #[test]
    fn a_fractional_scale_rounds_to_whole_pixels() {
        let work = WorkArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let p = &stack(Corner::BottomRight, work, 1.5, &[card(72.0)])[0];
        // Window: 340 + 48 = 388 logical = 582 px wide; right edge 16 - 24 = -8 logical beyond the card margin.
        assert_eq!(p.width, 582);
        assert_eq!(p.x, 1920 - 582 + 12);
    }

    #[test]
    fn an_empty_stack_places_nothing() {
        assert!(stack(Corner::BottomRight, WORK, 1.0, &[]).is_empty());
    }
}
