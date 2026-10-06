//! LumenGrab native shell. Kept thin on purpose: product logic lives in TypeScript.

pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
