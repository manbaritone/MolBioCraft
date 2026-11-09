// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Regression: Set Origin must move primer binding coordinates together with
//! the sequence (previously only features were rotated, leaving primers
//! pointing at the wrong bases).

use molbiocraft_cloning::{get_sample_library, set_circular_origin};

#[test]
fn set_origin_rotates_primer_binding_sites_with_the_sequence() {
    let mut doc = get_sample_library()
        .into_iter()
        .find(|d| {
            matches!(d.topology, molbiocraft_core::types::Topology::Circular)
                && d.sequence.len() > 500
        })
        .expect("a circular sample construct");
    let l = doc.sequence.len();
    let template = doc.primers.first().cloned();
    let Some(mut primer) = template else {
        // Construct a primer on the fly if the sample carries none.
        panic!("sample construct without primers: {}", doc.name);
    };
    primer.bind_start = 301;
    primer.bind_end = 320;
    let bound = doc.sequence[300..320].to_string();
    doc.primers = vec![primer];

    let rotated = set_circular_origin(&doc, 101);
    assert_eq!(rotated.sequence.len(), l);
    let p = &rotated.primers[0];
    assert_eq!((p.bind_start, p.bind_end), (201, 220));
    assert_eq!(&rotated.sequence[p.bind_start - 1..p.bind_end], bound);

    // Rotating back restores the original coordinates exactly.
    let back = set_circular_origin(&rotated, l - 100 + 1);
    assert_eq!(back.sequence, doc.sequence);
    assert_eq!(
        (back.primers[0].bind_start, back.primers[0].bind_end),
        (301, 320)
    );
}
