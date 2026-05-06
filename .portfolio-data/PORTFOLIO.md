# Pomodoro Overlay

## The What

A lightweight Pomodoro timer that lives as a small, draggable overlay on the Windows desktop. It stays in a corner, fades to near-invisible when you're not looking at it, and snaps back to its corner after you drag it. Three phases: focus, short break, long break. Controls appear only on hover and disappear otherwise, keeping the overlay unobtrusive during deep work.

## The Why

Every Pomodoro app I tried was either a full window that cluttered the taskbar, a browser tab I'd accidentally close, or a system tray widget with no visible timer. The goal was something that shows the countdown at a glance without taking focus or screen space - closer to a physical desk timer than a productivity app.

## The How

Built with Tauri 2 to keep the binary tiny and native. The overlay is transparent by default and uses WinAPI calls for corner-dragging rather than Tauri's built-in resize API, which was removed in 2.x. Do Not Disturb mode is implemented by writing directly to the Windows CloudStore registry blob that controls quiet hours - there's no public API for this, so it required reverse-engineering the binary format. Music pause-on-break uses the Windows Media Session API via the `windows` crate's WinRT bindings.
