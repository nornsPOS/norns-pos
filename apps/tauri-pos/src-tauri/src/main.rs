// Tauri 2 entry. Day 2 ships an empty shell — Day 3 wires the Rust-side
// commands for native bridges (ESC/POS printer, ZVT card terminal, TSE).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    norns_pos_lib::run()
}
