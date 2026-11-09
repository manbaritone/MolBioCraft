// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Hierarchical Newick Grammar Parser & `petgraph::graph::DiGraph` Phylogenetic Tree Layout Engine
//! generating exact rectangular (`phylogram`, `cladogram`) and circular/polar (`radial`) SVG coordinates,
//! orthogonal L-elbow & polar-arc `<path>` primitives, internal clade bootstrap badges, and scale bars.

use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::Direction;
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

#[derive(Debug, Clone, Default)]
struct RawTreeNode {
    label: String,
    bootstrap: Option<u32>,
    branch_length: f64,
    has_explicit_length: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewickSvgBranchPath {
    pub id: String,
    pub d: String,
    pub is_terminal: bool,
    pub branch_length: f64,
    pub target_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewickLayoutNode {
    pub node_id: usize,
    pub x: f64,
    pub y: f64,
    pub label: String,
    pub bootstrap: Option<u32>,
    pub branch_length: f64,
    pub depth_distance: f64,
    pub is_tip: bool,
    pub is_root: bool,
    pub label_x: f64,
    pub label_y: f64,
    pub label_angle_deg: f64,
    pub text_anchor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewickScaleBar {
    pub x1: f64,
    pub x2: f64,
    pub y: f64,
    pub units: f64,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewickTreeLayoutReport {
    pub style: String,
    pub width: f64,
    pub height: f64,
    pub total_nodes: usize,
    pub tip_count: usize,
    pub internal_count: usize,
    pub max_root_to_tip_distance: f64,
    pub total_tree_length: f64,
    pub root_x: f64,
    pub root_y: f64,
    pub svg_paths: Vec<NewickSvgBranchPath>,
    pub nodes: Vec<NewickLayoutNode>,
    pub scale_bar: Option<NewickScaleBar>,
}

struct NewickParser<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> NewickParser<'a> {
    fn new(src: &'a str) -> Self {
        Self {
            bytes: src.trim().as_bytes(),
            pos: 0,
        }
    }

    fn skip_ws(&mut self) {
        while self.pos < self.bytes.len() && self.bytes[self.pos].is_ascii_whitespace() {
            self.pos += 1;
        }
    }

    fn peek(&mut self) -> Option<u8> {
        self.skip_ws();
        self.bytes.get(self.pos).copied()
    }

    fn read_token(&mut self) -> String {
        self.skip_ws();
        if self.pos >= self.bytes.len() {
            return String::new();
        }
        let first = self.bytes[self.pos];
        if first == b'\'' || first == b'"' {
            let quote = first;
            self.pos += 1;
            let start = self.pos;
            while self.pos < self.bytes.len() && self.bytes[self.pos] != quote {
                self.pos += 1;
            }
            let out = String::from_utf8_lossy(&self.bytes[start..self.pos]).into_owned();
            if self.pos < self.bytes.len() {
                self.pos += 1;
            }
            return out;
        }

        let start = self.pos;
        while self.pos < self.bytes.len() {
            let b = self.bytes[self.pos];
            if matches!(b, b'(' | b')' | b',' | b':' | b';') || b.is_ascii_whitespace() {
                break;
            }
            self.pos += 1;
        }
        String::from_utf8_lossy(&self.bytes[start..self.pos]).into_owned()
    }

    fn parse_subtree(&mut self, graph: &mut DiGraph<RawTreeNode, f64>) -> NodeIndex {
        let mut children: Vec<NodeIndex> = Vec::new();
        if self.peek() == Some(b'(') {
            self.pos += 1; // consume '('
            loop {
                let child = self.parse_subtree(graph);
                children.push(child);
                match self.peek() {
                    Some(b',') => {
                        self.pos += 1;
                    }
                    Some(b')') => {
                        self.pos += 1;
                        break;
                    }
                    _ => break,
                }
            }
        }

        let raw_name = if !matches!(
            self.peek(),
            Some(b':') | Some(b',') | Some(b')') | Some(b';') | None
        ) {
            self.read_token()
        } else {
            String::new()
        };

        let mut branch_len = 0.0_f64;
        let mut has_len = false;
        if self.peek() == Some(b':') {
            self.pos += 1;
            let num_tok = self.read_token();
            if let Ok(v) = num_tok.parse::<f64>() {
                branch_len = v.max(0.0);
                has_len = true;
            }
        }

        let is_internal = !children.is_empty();
        let (label, bootstrap) = if is_internal {
            if let Ok(bs) = raw_name.parse::<f64>() {
                let pct = if bs <= 1.0 && raw_name.contains('.') {
                    (bs * 100.0).round() as u32
                } else {
                    bs.round().clamp(0.0, 100.0) as u32
                };
                (String::new(), Some(pct))
            } else {
                (raw_name, None)
            }
        } else {
            (
                if raw_name.is_empty() {
                    "Taxon".to_string()
                } else {
                    raw_name
                },
                None,
            )
        };

        let nx = graph.add_node(RawTreeNode {
            label,
            bootstrap,
            branch_length: branch_len,
            has_explicit_length: has_len,
        });
        for ch in children {
            let w = graph[ch].branch_length;
            graph.add_edge(nx, ch, w);
        }
        nx
    }
}

/// Pick a 1/2/5×10^k scale-bar length whose drawn width (`px_per_unit` × units) falls in a
/// readable range. The bar is then drawn at exactly that width — never clamped — so it matches
/// its label.
fn choose_scale_bar(max_dist: f64, px_per_unit: f64, lo_px: f64, hi_px: f64) -> (f64, f64) {
    if !(max_dist > 0.0) || !(px_per_unit > 0.0) {
        return (0.0, 0.0);
    }
    let mut best = (f64::NAN, f64::INFINITY);
    for exp in -6..=4 {
        for m in [1.0, 2.0, 5.0] {
            let u = m * 10f64.powi(exp);
            let px = u * px_per_unit;
            let target = 0.5 * (lo_px + hi_px);
            let score = if (lo_px..=hi_px).contains(&px) { (px - target).abs() } else { 1e6 + (px - target).abs() };
            if score < best.1 {
                best = (u, score);
            }
        }
    }
    (best.0, best.0 * px_per_unit)
}

/// Parses an arbitrary Newick string into a `petgraph::graph::DiGraph` and computes complete
/// rectangular (`"phylogram"`, `"cladogram"`) or circular (`"radial"`) SVG coordinates and branch paths.
pub fn layout_newick_phylogenetic_tree(
    newick: &str,
    style: &str,
    width: f64,
    height: f64,
) -> NewickTreeLayoutReport {
    let w = width.clamp(360.0, 2400.0);
    let h = height.clamp(220.0, 2400.0);
    let norm_style = match style.trim().to_ascii_lowercase().as_str() {
        "cladogram" => "cladogram",
        "radial" | "circular" => "radial",
        _ => "phylogram",
    };

    let mut graph: DiGraph<RawTreeNode, f64> = DiGraph::new();
    let trimmed = newick.trim();
    if trimmed.is_empty() || trimmed == "();" || trimmed == ";" {
        return NewickTreeLayoutReport {
            style: norm_style.into(),
            width: w,
            height: h,
            total_nodes: 0,
            tip_count: 0,
            internal_count: 0,
            max_root_to_tip_distance: 0.0,
            total_tree_length: 0.0,
            root_x: 32.0,
            root_y: h * 0.5,
            svg_paths: Vec::new(),
            nodes: Vec::new(),
            scale_bar: None,
        };
    }

    let mut parser = NewickParser::new(trimmed);
    let root = parser.parse_subtree(&mut graph);
    let n_nodes = graph.node_count();

    // Collect children in insertion order (petgraph outgoing neighbors reverse insertion order -> reverse!)
    let children_of = |g: &DiGraph<RawTreeNode, f64>, nx: NodeIndex| -> Vec<NodeIndex> {
        let mut ch: Vec<NodeIndex> = g.neighbors_directed(nx, Direction::Outgoing).collect();
        ch.reverse();
        ch
    };

    let any_explicit_len = graph
        .node_indices()
        .any(|nx| nx != root && graph[nx].has_explicit_length && graph[nx].branch_length > 0.0);

    // Post-order traversal: assign leaf slots (0..tip_count) and topological height (steps from tips)
    let mut slot_pos = vec![0.0_f64; n_nodes];
    let mut topo_height = vec![0usize; n_nodes];
    let mut max_topo_depth = vec![0usize; n_nodes];
    let mut tip_counter = 0usize;

    fn post_order(
        nx: NodeIndex,
        depth: usize,
        g: &DiGraph<RawTreeNode, f64>,
        slot_pos: &mut [f64],
        topo_height: &mut [usize],
        max_topo_depth: &mut [usize],
        tip_counter: &mut usize,
    ) {
        let mut ch: Vec<NodeIndex> = g.neighbors_directed(nx, Direction::Outgoing).collect();
        ch.reverse();
        max_topo_depth[nx.index()] = depth;
        if ch.is_empty() {
            slot_pos[nx.index()] = *tip_counter as f64;
            topo_height[nx.index()] = 0;
            *tip_counter += 1;
        } else {
            let mut sum_slot = 0.0;
            let mut max_h = 0usize;
            for &c in &ch {
                post_order(
                    c,
                    depth + 1,
                    g,
                    slot_pos,
                    topo_height,
                    max_topo_depth,
                    tip_counter,
                );
                sum_slot += slot_pos[c.index()];
                max_h = max_h.max(topo_height[c.index()] + 1);
            }
            slot_pos[nx.index()] = sum_slot / (ch.len() as f64);
            topo_height[nx.index()] = max_h;
        }
    }

    post_order(
        root,
        0,
        &graph,
        &mut slot_pos,
        &mut topo_height,
        &mut max_topo_depth,
        &mut tip_counter,
    );

    let tip_count = tip_counter.max(1);
    let internal_count = n_nodes.saturating_sub(tip_counter);
    let root_topo_height = topo_height[root.index()].max(1);

    // Pre-order traversal: compute cumulative evolutionary distance from root & normalized X depth [0.0..1.0]
    let mut patristic_depth = vec![0.0_f64; n_nodes];
    let mut total_tree_len = 0.0_f64;

    fn pre_order_dist(
        nx: NodeIndex,
        cur_dist: f64,
        is_root: bool,
        any_explicit: bool,
        g: &DiGraph<RawTreeNode, f64>,
        patristic: &mut [f64],
        total_len: &mut f64,
    ) {
        let br = if is_root {
            0.0
        } else if any_explicit {
            g[nx].branch_length
        } else {
            1.0
        };
        let d = cur_dist + br;
        patristic[nx.index()] = d;
        *total_len += br;
        let mut ch: Vec<NodeIndex> = g.neighbors_directed(nx, Direction::Outgoing).collect();
        ch.reverse();
        for c in ch {
            pre_order_dist(c, d, false, any_explicit, g, patristic, total_len);
        }
    }

    pre_order_dist(
        root,
        0.0,
        true,
        any_explicit_len,
        &graph,
        &mut patristic_depth,
        &mut total_tree_len,
    );

    let max_patristic = patristic_depth
        .iter()
        .copied()
        .fold(0.0_f64, f64::max)
        .max(1e-6);

    // Normalized radial/horizontal depth fraction [0.0..1.0]:
    // - phylogram (with explicit lengths): proportional to cumulative evolutionary branch length
    // - cladogram (or unbranched topology): ultrametric aligned tips (`1.0 - topo_height / root_height`)
    let use_cladogram_depth = norm_style == "cladogram" || !any_explicit_len;
    let depth_frac: Vec<f64> = (0..n_nodes)
        .map(|i| {
            if i == root.index() {
                0.0
            } else if use_cladogram_depth {
                let h_node = topo_height[i];
                ((root_topo_height.saturating_sub(h_node)) as f64 / root_topo_height as f64)
                    .clamp(0.0, 1.0)
            } else {
                (patristic_depth[i] / max_patristic).clamp(0.0, 1.0)
            }
        })
        .collect();

    let mut nodes_out = Vec::with_capacity(n_nodes);
    let mut svg_paths = Vec::new();
    let round2 = |v: f64| (v * 100.0).round() / 100.0;

    if norm_style == "radial" {
        let cx = w * 0.5;
        let cy = h * 0.5;
        let max_r = (w.min(h) * 0.5 - 92.0).max(55.0);
        // Span 335 degrees so root/first-last clade gap is visually distinct
        let angle_span = 2.0 * PI * (335.0 / 360.0);
        let start_angle = -PI * 0.5 + (2.0 * PI - angle_span) * 0.5;

        let angle_of = |idx: usize| -> f64 {
            if tip_count <= 1 {
                0.0
            } else {
                start_angle + (slot_pos[idx] / (tip_count as f64)) * angle_span
            }
        };
        let radius_of = |idx: usize| -> f64 { depth_frac[idx] * max_r };

        for nx in graph.node_indices() {
            let i = nx.index();
            let r = radius_of(i);
            let ang = angle_of(i);
            let x = if nx == root { cx } else { cx + r * ang.cos() };
            let y = if nx == root { cy } else { cy + r * ang.sin() };
            let ch = children_of(&graph, nx);
            let is_tip = ch.is_empty();

            let label_r = r + 10.0;
            let lx = cx + label_r * ang.cos();
            let ly = cy + label_r * ang.sin();
            let mut deg = ang * 180.0 / PI;
            while deg < -180.0 {
                deg += 360.0;
            }
            while deg > 180.0 {
                deg -= 360.0;
            }
            let (rot_deg, anchor) = if (-90.0..=90.0).contains(&deg) {
                (deg, "start")
            } else {
                (deg + 180.0, "end")
            };

            nodes_out.push(NewickLayoutNode {
                node_id: i,
                x: round2(x),
                y: round2(y),
                label: graph[nx].label.clone(),
                bootstrap: graph[nx].bootstrap,
                branch_length: (graph[nx].branch_length * 10000.0).round() / 10000.0,
                depth_distance: (patristic_depth[i] * 10000.0).round() / 10000.0,
                is_tip,
                is_root: nx == root,
                label_x: round2(lx),
                label_y: round2(ly),
                label_angle_deg: round2(rot_deg),
                text_anchor: anchor.into(),
            });

            // Emit circular shoulder arc across children at radius `r` + radial spoke to each child
            if !ch.is_empty() {
                if r > 0.5 && ch.len() >= 2 {
                    let a_min = ch
                        .iter()
                        .map(|c| angle_of(c.index()))
                        .fold(f64::INFINITY, f64::min);
                    let a_max = ch
                        .iter()
                        .map(|c| angle_of(c.index()))
                        .fold(f64::NEG_INFINITY, f64::max);
                    let sx = cx + r * a_min.cos();
                    let sy = cy + r * a_min.sin();
                    let ex = cx + r * a_max.cos();
                    let ey = cy + r * a_max.sin();
                    let large_arc = if (a_max - a_min) > PI { 1 } else { 0 };
                    svg_paths.push(NewickSvgBranchPath {
                        id: format!("arc-{i}"),
                        d: format!(
                            "M {:.2} {:.2} A {:.2} {:.2} 0 {} 1 {:.2} {:.2}",
                            sx, sy, r, r, large_arc, ex, ey
                        ),
                        is_terminal: false,
                        branch_length: 0.0,
                        target_label: String::new(),
                    });
                }
                for c in ch {
                    let ci = c.index();
                    let c_ang = angle_of(ci);
                    let c_rad = radius_of(ci);
                    let sx = if r <= 0.5 { cx } else { cx + r * c_ang.cos() };
                    let sy = if r <= 0.5 { cy } else { cy + r * c_ang.sin() };
                    let ex = cx + c_rad * c_ang.cos();
                    let ey = cy + c_rad * c_ang.sin();
                    let c_is_tip = children_of(&graph, c).is_empty();
                    svg_paths.push(NewickSvgBranchPath {
                        id: format!("ray-{i}-{ci}"),
                        d: format!("M {:.2} {:.2} L {:.2} {:.2}", sx, sy, ex, ey),
                        is_terminal: c_is_tip,
                        branch_length: (graph[c].branch_length * 10000.0).round() / 10000.0,
                        target_label: graph[c].label.clone(),
                    });
                }
            }
        }

        let scale_bar = if !use_cladogram_depth && any_explicit_len {
            let (units, px) = choose_scale_bar(max_patristic, max_r / max_patristic, 24.0, 140.0);
            Some(NewickScaleBar {
                x1: 24.0,
                x2: round2(24.0 + px),
                y: round2(h - 16.0),
                units,
                label: format!("{units} subst./site"),
            })
        } else {
            None
        };

        return NewickTreeLayoutReport {
            style: norm_style.into(),
            width: w,
            height: h,
            total_nodes: n_nodes,
            tip_count,
            internal_count,
            max_root_to_tip_distance: (max_patristic * 10000.0).round() / 10000.0,
            total_tree_length: (total_tree_len * 10000.0).round() / 10000.0,
            root_x: round2(cx),
            root_y: round2(cy),
            svg_paths,
            nodes: nodes_out,
            scale_bar,
        };
    }

    // Rectangular orthogonal layout ("phylogram" or "cladogram")
    let pad_left = 34.0;
    let pad_right = 195.0;
    let pad_top = 24.0;
    let pad_bottom = 36.0;
    let plot_w = (w - pad_left - pad_right).max(120.0);
    let plot_h = (h - pad_top - pad_bottom).max(100.0);

    let x_of = |idx: usize| -> f64 { pad_left + depth_frac[idx] * plot_w };
    let y_of = |idx: usize| -> f64 {
        if tip_count <= 1 {
            pad_top + plot_h * 0.5
        } else {
            pad_top + (slot_pos[idx] / ((tip_count - 1) as f64)) * plot_h
        }
    };

    // Short root stem on the left
    let root_x = x_of(root.index());
    let root_y = y_of(root.index());
    svg_paths.push(NewickSvgBranchPath {
        id: "root-stem".into(),
        d: format!("M {:.2} {:.2} L {:.2} {:.2}", (root_x - 14.0).max(8.0), root_y, root_x, root_y),
        is_terminal: false,
        branch_length: 0.0,
        target_label: "root".into(),
    });

    for nx in graph.node_indices() {
        let i = nx.index();
        let px = x_of(i);
        let py = y_of(i);
        let ch = children_of(&graph, nx);
        let is_tip = ch.is_empty();

        nodes_out.push(NewickLayoutNode {
            node_id: i,
            x: round2(px),
            y: round2(py),
            label: graph[nx].label.clone(),
            bootstrap: graph[nx].bootstrap,
            branch_length: (graph[nx].branch_length * 10000.0).round() / 10000.0,
            depth_distance: (patristic_depth[i] * 10000.0).round() / 10000.0,
            is_tip,
            is_root: nx == root,
            label_x: round2(px + 8.0),
            label_y: round2(py + 4.0),
            label_angle_deg: 0.0,
            text_anchor: "start".into(),
        });

        for c in ch {
            let ci = c.index();
            let cx = x_of(ci);
            let cy = y_of(ci);
            let c_is_tip = children_of(&graph, c).is_empty();
            svg_paths.push(NewickSvgBranchPath {
                id: format!("br-{i}-{ci}"),
                d: format!("M {:.2} {:.2} L {:.2} {:.2} L {:.2} {:.2}", px, py, px, cy, cx, cy),
                is_terminal: c_is_tip,
                branch_length: (graph[c].branch_length * 10000.0).round() / 10000.0,
                target_label: graph[c].label.clone(),
            });
        }
    }

    let scale_bar = if !use_cladogram_depth && any_explicit_len {
        let (units, px) = choose_scale_bar(max_patristic, plot_w / max_patristic, 28.0, 180.0);
        Some(NewickScaleBar {
            x1: pad_left,
            x2: round2(pad_left + px),
            y: round2(h - 12.0),
            units,
            label: format!("{units} subst./site"),
        })
    } else {
        None
    };

    NewickTreeLayoutReport {
        style: norm_style.into(),
        width: w,
        height: h,
        total_nodes: n_nodes,
        tip_count,
        internal_count,
        max_root_to_tip_distance: (max_patristic * 10000.0).round() / 10000.0,
        total_tree_length: (total_tree_len * 10000.0).round() / 10000.0,
        root_x: round2(root_x),
        root_y: round2(root_y),
        svg_paths,
        nodes: nodes_out,
        scale_bar,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_newick_and_computes_phylogram_cladogram_and_radial_svg_layouts() {
        let nwk = "((eGFP_WT:0.0420,EYFP_T203Y:0.0580)96:0.0310,(ECFP_Y66W:0.0750,mCherry:0.1840)88:0.0620);";

        let phylo = layout_newick_phylogenetic_tree(nwk, "phylogram", 760.0, 280.0);
        assert_eq!(phylo.tip_count, 4);
        assert_eq!(phylo.internal_count, 3);
        assert!(phylo.scale_bar.is_some());
        assert!(phylo.nodes.iter().any(|n| n.bootstrap == Some(96)));

        let clado = layout_newick_phylogenetic_tree(nwk, "cladogram", 760.0, 280.0);
        let tip_xs: Vec<f64> = clado.nodes.iter().filter(|n| n.is_tip).map(|n| n.x).collect();
        assert_eq!(tip_xs.len(), 4);
        assert!((tip_xs[0] - tip_xs[3]).abs() < 0.05);

        let radial = layout_newick_phylogenetic_tree(nwk, "radial", 500.0, 340.0);
        assert!(radial.svg_paths.iter().any(|p| p.d.contains(" A ")));
    }
}

#[cfg(test)]
mod scale_bar_tests {
    use super::*;

    #[test]
    fn scale_bar_width_always_equals_its_label() {
        for (max_d, width) in [(0.0123, 400.0), (0.8, 1400.0), (3.0, 500.0), (0.0004, 900.0)] {
            let (u, px) = choose_scale_bar(max_d, width / max_d, 28.0, 180.0);
            assert!((px - u * width / max_d).abs() < 1e-9);
            assert!((28.0..=180.0).contains(&px), "{max_d} {width} -> {u} {px}");
        }
    }
}
