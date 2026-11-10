use super::*;

const WORK: Rect = Rect { x: 100, y: 50, w: 1920, h: 1000 };

fn bar(edge: &str, size: &str) -> Rect {
    bar_rect(WORK, 1.0, edge, size, 0)
}

#[test]
fn top_and_bottom_span_full_width_with_a_preset_thickness() {
    for (size, thick) in [("small", 44), ("medium", 56), ("large", 72)] {
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
    for (size, w) in [("small", 104), ("medium", 120), ("large", 136)] {
        assert_eq!(bar("left", size), Rect { x: 100, y: 50, w, h: 1000 }, "left {size}");
        assert_eq!(
            bar("right", size),
            Rect { x: 100 + 1920 - w as i32, y: 50, w, h: 1000 },
            "right {size}"
        );
    }
}

#[test]
fn thickness_is_logical_so_it_scales_with_the_monitor_not_the_work_area() {
    // A 4K portrait monitor at 150%: 3768 physical px tall work area. The bar is
    // 56 logical px = 84 physical, not a share of the height.
    let tall = Rect { x: 2560, y: -1279, w: 2160, h: 3768 };
    assert_eq!(bar_rect(tall, 1.5, "top", "medium", 0).h, 84);
    assert_eq!(bar_rect(tall, 1.5, "bottom", "medium", 0).h, 84);
    assert_eq!(bar_rect(tall, 1.5, "top", "medium", 0).w, 2160);
    assert_eq!(bar_rect(tall, 1.5, "left", "medium", 0).w, 180);
    assert_eq!(bar_rect(tall, 1.5, "left", "medium", 0).h, 3768);
    // Same logical size on a work area half the height.
    let short = Rect { h: 1884, ..tall };
    assert_eq!(bar_rect(short, 1.5, "top", "medium", 0).h, 84);
}

#[test]
fn a_hand_resized_thickness_replaces_the_preset() {
    assert_eq!(bar_rect(WORK, 1.0, "top", "medium", 80).h, 80);
    assert_eq!(bar_rect(WORK, 2.0, "top", "small", 80).h, 160);
    assert_eq!(bar_rect(WORK, 1.0, "left", "small", 140).w, 140);
}

#[test]
fn thickness_is_clamped_to_a_hard_range() {
    for (custom, h) in [(1, 36), (500, 96), (u32::MAX, 96)] {
        assert_eq!(bar_rect(WORK, 1.0, "top", "medium", custom).h, h, "top {custom}");
    }
    for (custom, w) in [(1, 96), (500, 160), (u32::MAX, 160)] {
        assert_eq!(bar_rect(WORK, 1.0, "left", "medium", custom).w, w, "left {custom}");
    }
    assert_eq!(bar_rect(WORK, 1.5, "top", "large", 500).h, 144);
}

#[test]
fn a_bar_never_outgrows_a_tiny_work_area() {
    let tiny = Rect { x: 0, y: 0, w: 80, h: 50 };
    assert_eq!(bar_rect(tiny, 1.0, "left", "large", 0).w, 80);
    assert_eq!(bar_rect(tiny, 2.0, "top", "large", 0).h, 50);
}

#[test]
fn dragged_extent_converts_back_to_clamped_logical_thickness() {
    assert_eq!(thickness_from_extent("top", 84, 1.5), 56);
    assert_eq!(thickness_from_extent("top", 120, 1.5), 80);
    assert_eq!(thickness_from_extent("top", 5000, 1.5), 96);
    assert_eq!(thickness_from_extent("bottom", 10, 1.0), 36);
    assert_eq!(thickness_from_extent("left", 90, 1.0), 96);
    assert_eq!(thickness_from_extent("right", 900, 1.0), 160);
}

#[test]
fn our_own_placement_never_reads_back_as_a_hand_drag() {
    // save_thickness ignores a difference of 1 or less; if placement did not
    // round-trip, every placement would persist itself and loop.
    for scale in [1.0, 1.25, 1.5, 1.75, 2.0, 3.0] {
        for edge in ["top", "bottom", "left", "right"] {
            for custom in [0, 40, 57, 73, 96, 130, 160] {
                let r = bar_rect(WORK, scale, edge, "medium", custom);
                let extent = if edge == "left" || edge == "right" { r.w } else { r.h };
                let back = thickness_from_extent(edge, extent, scale);
                let want = bar_thickness(edge, "medium", custom);
                assert!(back.abs_diff(want) <= 1, "{edge} {custom} @{scale}: {back} vs {want}");
            }
        }
    }
}

#[test]
fn unknown_values_fall_back_to_top_bar_medium() {
    assert_eq!(bar_rect(WORK, 1.0, "diagonal", "huge", 0), bar("top", "medium"));
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
