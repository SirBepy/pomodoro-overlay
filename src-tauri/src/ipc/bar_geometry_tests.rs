use super::*;

const WORK: Rect = Rect { x: 100, y: 50, w: 1920, h: 1000 };

fn bar(edge: &str, size: &str) -> Rect {
    bar_rect(WORK, 1.0, edge, size)
}

#[test]
fn top_and_bottom_span_full_width_with_a_share_of_the_height() {
    for (size, thick) in [("small", 100), ("medium", 140), ("large", 180)] {
        assert_eq!(bar("top", size), Rect { x: 100, y: 50, w: 1920, h: thick }, "top {size}");
        assert_eq!(
            bar("bottom", size),
            Rect { x: 100, y: 50 + 1000 - thick as i32, w: 1920, h: thick },
            "bottom {size}"
        );
    }
}

#[test]
fn side_bars_span_full_height_and_stay_narrow() {
    for (size, w) in [("small", 112), ("medium", 128), ("large", 148)] {
        assert_eq!(bar("left", size), Rect { x: 100, y: 50, w, h: 1000 }, "left {size}");
        assert_eq!(
            bar("right", size),
            Rect { x: 100 + 1920 - w as i32, y: 50, w, h: 1000 },
            "right {size}"
        );
    }
}

#[test]
fn side_bar_width_follows_the_display_scale() {
    assert_eq!(bar_rect(WORK, 1.5, "left", "medium").w, 192);
}

#[test]
fn top_bar_never_drops_below_the_floor() {
    let short = Rect { x: 0, y: 0, w: 1280, h: 400 };
    assert_eq!(bar_rect(short, 1.0, "top", "small").h, MIN_BAR_THICKNESS);
}

#[test]
fn unknown_values_fall_back_to_top_bar_medium() {
    assert_eq!(bar_rect(WORK, 1.0, "diagonal", "huge"), bar("top", "medium"));
}

#[test]
fn drop_snaps_to_the_nearest_edge() {
    let snap = |p: (f64, f64)| snap_target(p, WORK);
    assert_eq!(snap((1000.0, 60.0)), "top");
    assert_eq!(snap((1000.0, 1040.0)), "bottom");
    assert_eq!(snap((105.0, 500.0)), "left");
    assert_eq!(snap((2015.0, 500.0)), "right");
}

#[test]
fn snap_normalises_distance_by_each_side() {
    // 300px from the left is 15.6% of the width, 200px from the top is 20% of
    // the height: left is nearer even though its pixel distance is larger.
    assert_eq!(snap_target((400.0, 250.0), WORK), "left");
}

const PRIMARY: MonitorKey = (0, 0);
const SECOND: MonitorKey = (1920, 0);

#[test]
fn overlay_mode_uses_the_box_monitor() {
    let got = resolve_monitor("overlay", &[PRIMARY, SECOND], Some(PRIMARY), Some(SECOND));
    assert_eq!(got, Some(SECOND));
}

#[test]
fn primary_mode_uses_the_primary_even_when_overlay_is_elsewhere() {
    let got = resolve_monitor("primary", &[PRIMARY, SECOND], Some(PRIMARY), Some(SECOND));
    assert_eq!(got, Some(PRIMARY));
}

#[test]
fn secondary_mode_skips_the_primary_wherever_it_sits_in_the_list() {
    for list in [[SECOND, PRIMARY], [PRIMARY, SECOND]] {
        let got = resolve_monitor("secondary", &list, Some(PRIMARY), Some(PRIMARY));
        assert_eq!(got, Some(SECOND), "{list:?}");
    }
}

#[test]
fn secondary_with_one_monitor_falls_back_to_overlay() {
    let got = resolve_monitor("secondary", &[PRIMARY], Some(PRIMARY), Some(PRIMARY));
    assert_eq!(got, Some(PRIMARY));
}

#[test]
fn an_unplugged_overlay_monitor_falls_back_to_a_live_one() {
    for mode in ["overlay", "primary", "secondary"] {
        let got = resolve_monitor(mode, &[SECOND], Some(PRIMARY), Some(PRIMARY));
        assert_eq!(got, Some(SECOND), "{mode}");
    }
}

#[test]
fn no_candidates_at_all_falls_back_to_the_first_monitor() {
    assert_eq!(resolve_monitor("overlay", &[SECOND], None, None), Some(SECOND));
    assert_eq!(resolve_monitor("overlay", &[], None, None), None);
}
