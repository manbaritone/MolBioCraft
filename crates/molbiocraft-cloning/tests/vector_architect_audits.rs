// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M6P2YG: the vector architect's three audits, pinned rule by rule.
//!
//! `crates/molbiocraft-cloning/src/lib.rs` only asserted that the Twist onboarding report has nine
//! checks, and `tests/restriction_site_cap.rs` pins the linearization rule's pass path on a 12 kb
//! fixture. Here each of the nine rules is given a construct that violates it and nothing else, so
//! a rule that stops firing - or starts firing on a clean construct - fails a test. The
//! linearization rule's deep pass path - sites that only a complete scan reaches - is not
//! duplicated: it stays with `restriction_site_cap.rs`, and only its warn path is written here.
//!
//! The modular-assembly test pins the studio's own default spec (the part ids of
//! `src/components/VectorLibraryAndDesignStudio.tsx:88-103`, system `sys-plv-exp`): if that default
//! changes, this test is the place to change it.

use molbiocraft_cloning::rebase_catalog::find_restriction_cut_sites;
use molbiocraft_cloning::{
    assemble_modular_custom_vector, audit_twist_custom_vector_onboarding,
    build_catalog_vector_document, check_cotransformation_compatibility, generate_catalog_circular_svg,
    get_modular_vector_parts, get_vector_catalog, CatalogVectorEntry, ModularAssemblySpec, TwistOnboardingReport,
};
use molbiocraft_core::types::{MoleculeType, SequenceDocument, SequenceFeature, Topology};

/// The nine Twist onboarding rules, in the order PRODUCT.md:35 and README.md:48 describe them.
const RULE_IDS: [&str; 9] = [
    "topology",
    "origin",
    "antibiotic",
    "ccdb",
    "homopolymer",
    "uniqueflanks",
    "linearization",
    "window-gc",
    "dna-sample",
];

fn catalog_entry(id: &str) -> CatalogVectorEntry {
    get_vector_catalog()
        .into_iter()
        .find(|e| e.id == id)
        .unwrap_or_else(|| panic!("the catalogue holds {id}"))
}

/// xorshift64* bases from a fixed seed: ~50% GC, no long homopolymer and no repeated 20-mer.
fn rand_dna(len: usize, seed: u64) -> String {
    let mut s = seed | 1;
    let mut out = String::with_capacity(len);
    for _ in 0..len {
        s ^= s >> 12;
        s ^= s << 25;
        s ^= s >> 27;
        let v = s.wrapping_mul(0x2545_F491_4F6C_DD1D);
        out.push(match (v >> 33) & 3 {
            0 => 'A',
            1 => 'C',
            2 => 'G',
            _ => 'T',
        });
    }
    out
}

/// A feature of `name`, carrying no notes, so only the name can answer a rule.
fn feature(template: &SequenceFeature, name: &str, kind: &str, start: usize, end: usize) -> SequenceFeature {
    let mut f = template.clone();
    f.id = format!("fix-{}", name.to_ascii_lowercase().replace(' ', "-"));
    f.name = name.to_string();
    f.feature_type = kind.to_string();
    f.start = start;
    f.end = end;
    f.notes = None;
    f
}

/// A construct that passes all nine rules: a circular 1,006 bp plasmid whose insertion window is
/// random 50% GC DNA with an EcoRI site at its centre, a pUC origin feature and an AmpR feature.
/// Its name and description carry no origin, marker or ccdB word, so each rule answers from one
/// feature or from the sequence and a variant below can take exactly one of them away.
fn clean_fixture() -> (SequenceDocument, usize) {
    let mut doc = build_catalog_vector_document(&catalog_entry("twist-cmv"));
    let template = doc.features[0].clone();
    doc.name = "Synthetic Onboarding Fixture".to_string();
    doc.description = String::new();
    doc.sequence = format!("{}GAATTC{}", rand_dna(500, 0xA11CE), rand_dna(500, 0x0B0B));
    doc.features = vec![
        feature(&template, "pUC Origin (High Copy)", "rep_origin", 1, 60),
        feature(&template, "AmpR", "CDS", 700, 1000),
    ];
    doc.primers = Vec::new();
    // The EcoRI site sits at 501-506; the insertion point is inside it.
    (doc, 503)
}

/// Every rule but `id` passes; `id` has `status`, and the report's overall status is `overall`.
fn assert_only(report: &TwistOnboardingReport, id: &str, status: &str, overall: &str) {
    assert!(RULE_IDS.contains(&id), "{id} is one of the nine rules");
    for check in &report.checks {
        let want = if check.id == id { status } else { "pass" };
        assert_eq!(check.status, want, "rule {}: {}", check.id, check.detail);
    }
    assert_eq!(report.overall_status, overall, "overall status for {id}");
}

/// How many REBASE cleavage sites fall within 50 bp of `site`, read from the scan the audit reads.
fn sites_within_50(seq: &str, topology: Topology, site: usize) -> usize {
    let len = seq.len();
    find_restriction_cut_sites(seq, topology, None)
        .iter()
        .filter(|cs| {
            let direct = cs.position.abs_diff(site);
            direct.min(len.saturating_sub(direct)) <= 50
        })
        .count()
}

#[test]
fn twist_onboarding_flags_each_rule() {
    // The pass path: the catalogue's pTwist CMV, inserted into its own MCS, shipped at spec.
    let doc = build_catalog_vector_document(&catalog_entry("twist-cmv"));
    let mcs = doc
        .features
        .iter()
        .find(|f| f.name.contains("MCS"))
        .expect("pTwist CMV carries an MCS feature");
    let report = audit_twist_custom_vector_onboarding(&doc, mcs.start + 4, 120.0, 150.0);
    assert_eq!(
        report.checks.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
        RULE_IDS.to_vec(),
        "the nine rules, in the documented order"
    );
    for check in &report.checks {
        assert_eq!(check.status, "pass", "rule {}: {}", check.id, check.detail);
    }
    assert_eq!(report.overall_status, "Ready for Onboarding");

    // The same, on the synthetic fixture every variant below is one edit away from.
    let (clean, site) = clean_fixture();
    let report = audit_twist_custom_vector_onboarding(&clean, site, 120.0, 150.0);
    for check in &report.checks {
        assert_eq!(check.status, "pass", "clean fixture, rule {}: {}", check.id, check.detail);
    }
    assert_eq!(report.overall_status, "Ready for Onboarding");

    // 1. topology: linear, and nothing else changed.
    let mut linear = clean.clone();
    linear.topology = Topology::Linear;
    let report = audit_twist_custom_vector_onboarding(&linear, site, 120.0, 150.0);
    assert_only(&report, "topology", "fail", "Action Required (Blocked)");
    assert!(
        report.checks[0].detail.contains("linear DNA"),
        "{}",
        report.checks[0].detail
    );
    // The same rule's length half: a 900 bp circular plasmid is too short to onboard.
    let mut short = clean.clone();
    short.sequence.truncate(900);
    let report = audit_twist_custom_vector_onboarding(&short, site, 120.0, 150.0);
    let topo = &report.checks[0];
    assert_eq!(topo.status, "fail", "{}", topo.detail);
    assert!(topo.detail.contains("900 bp"), "{}", topo.detail);
    assert_eq!(report.overall_status, "Action Required (Blocked)");

    // 2. origin: a low-copy pSC101 origin is rejected even beside the pUC one.
    let mut low_copy = clean.clone();
    let template = low_copy.features[0].clone();
    low_copy
        .features
        .push(feature(&template, "pSC101 Origin", "rep_origin", 100, 160));
    let report = audit_twist_custom_vector_onboarding(&low_copy, site, 120.0, 150.0);
    assert_only(&report, "origin", "fail", "Action Required (Blocked)");
    assert!(report.checks[1].detail.contains("pSC101"), "{}", report.checks[1].detail);

    // 3. antibiotic: no marker feature, and no AmpR or KanR sequence either.
    let mut unmarked = clean.clone();
    unmarked.features.retain(|f| f.name != "AmpR");
    assert!(
        !unmarked.sequence.contains("ATGAGTATTCAACATTTCCGTGTCGCC")
            && !unmarked.sequence.contains("ATGATTGAACAAGATGGATTGCACGCA"),
        "the fixture carries no bla or aph coding start"
    );
    let report = audit_twist_custom_vector_onboarding(&unmarked, site, 120.0, 150.0);
    assert_only(&report, "antibiotic", "fail", "Action Required (Blocked)");

    // 4. ccdb: the gyrase toxin left in the final clonal product.
    let mut toxic = clean.clone();
    toxic.features.push(feature(&template, "ccdB", "CDS", 200, 500));
    let report = audit_twist_custom_vector_onboarding(&toxic, site, 120.0, 150.0);
    assert_only(&report, "ccdb", "fail", "Action Required (Blocked)");

    // 5. homopolymer: a 14 bp A run 4 bp past the insertion point.
    let mut homo = clean.clone();
    homo.sequence = format!(
        "{}GAATTC{}{}",
        rand_dna(500, 0xA11CE),
        "A".repeat(14),
        &rand_dna(500, 0x0B0B)[14..]
    );
    let report = audit_twist_custom_vector_onboarding(&homo, site, 120.0, 150.0);
    assert_only(&report, "homopolymer", "fail", "Action Required (Blocked)");
    assert!(report.checks[4].detail.contains("14-bp A"), "{}", report.checks[4].detail);

    // 6. uniqueflanks: one 20-mer in both of the ±40 bp homology arms. The window is the 80 bases
    // from 500 (0-based), so the repeat is written at its base and 40 bases on, with an EcoRI site
    // between the copies to leave the linearization rule passing.
    let repeat = rand_dna(20, 0x5EED);
    let mut repeated = clean.clone();
    repeated.sequence = format!(
        "{}{repeat}GAATTC{}{repeat}{}",
        rand_dna(500, 0xA11CE),
        rand_dna(14, 0xFACE),
        rand_dna(500, 0x0B0B)
    );
    let report = audit_twist_custom_vector_onboarding(&repeated, 541, 120.0, 150.0);
    assert_only(&report, "uniqueflanks", "fail", "Action Required (Blocked)");

    // 7. linearization: a (GT)n / (GA)n insertion window no REBASE enzyme cuts within 50 bp. This
    // is the rule's warn path; restriction_site_cap.rs owns the 12 kb pass fixture.
    let mut uncuttable = clean.clone();
    uncuttable.sequence = format!(
        "{}{}{}{}",
        rand_dna(430, 0xA11CE),
        "GT".repeat(35),
        "GA".repeat(35),
        rand_dna(430, 0x0B0B)
    );
    assert_eq!(
        sites_within_50(&uncuttable.sequence, Topology::Circular, 500),
        0,
        "the fixture: no cleavage site within 50 bp of bp 500"
    );
    let report = audit_twist_custom_vector_onboarding(&uncuttable, 500, 120.0, 150.0);
    assert_only(&report, "linearization", "warn", "Review Warnings");
    assert!(report.nearby_linearization_enzymes.is_empty());

    // 8. window-gc: an all-A/T ±50 bp window, still cut nearby and still without a repeat shared
    // between its arms (periods 6 and 5 share no 20-mer).
    let mut at_only = clean.clone();
    at_only.sequence = format!(
        "{}{}{}{}",
        rand_dna(430, 0xA11CE),
        "ATTAAT".repeat(12),
        "AATAT".repeat(14),
        rand_dna(430, 0x0B0B)
    );
    assert!(
        sites_within_50(&at_only.sequence, Topology::Circular, 502) > 0,
        "the fixture: the A/T window is still cut within 50 bp"
    );
    let report = audit_twist_custom_vector_onboarding(&at_only, 502, 120.0, 150.0);
    assert_only(&report, "window-gc", "warn", "Review Warnings");
    assert!(report.checks[7].detail.contains("0.0%"), "{}", report.checks[7].detail);

    // 9. dna-sample: 50 µL of the shipment spec's 100, so 7.5 µg of its 10.
    let report = audit_twist_custom_vector_onboarding(&clean, site, 50.0, 150.0);
    assert_only(&report, "dna-sample", "warn", "Review Warnings");
    assert_eq!(report.total_mass_ug, 7.5);
}

#[test]
fn default_cassette_assembles_in_documented_order() {
    // The studio's initial Modular Vector Architect state, VectorLibraryAndDesignStudio.tsx:88-103.
    let spec = ModularAssemblySpec {
        vector_name: "pMBC-EF1A-3xFLAG-mScarlet3-P2A-Puro".to_string(),
        system_guide_id: "sys-plv-exp".to_string(),
        promoter_part_id: "prom-ef1a".to_string(),
        signal_or_init_part_id: Some("sig-kozak".to_string()),
        n_tag_part_id: Some("tag-3xflag".to_string()),
        protease_part_id: Some("prot-tev".to_string()),
        cargo_mode: "part".to_string(),
        cargo_part_id: Some("orf-mscarlet3".to_string()),
        custom_cargo_name: Some("Custom_GOI".to_string()),
        custom_cargo_seq: Some("ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCTAA".to_string()),
        linker_2a_part_id: Some("lnk-p2a".to_string()),
        eukaryotic_marker_part_id: Some("sel-puror".to_string()),
        regulatory_wpre_part_id: Some("reg-wpre".to_string()),
        poly_a_or_term_part_id: "reg-bghpa".to_string(),
        origin_part_id: "ori-puc".to_string(),
        bacterial_marker_part_id: "sel-ampr".to_string(),
    };
    // A lentiviral system flanks the cassette with its SIN LTR, and the backbone closes with the
    // bacterial origin and marker.
    let expected_ids = [
        "vir-sinltr",
        "prom-ef1a",
        "sig-kozak",
        "tag-3xflag",
        "prot-tev",
        "orf-mscarlet3",
        "lnk-p2a",
        "sel-puror",
        "reg-wpre",
        "reg-bghpa",
        "vir-sinltr",
        "ori-puc",
        "sel-ampr",
    ];
    let parts = get_modular_vector_parts();
    let expected_names: Vec<String> = expected_ids
        .iter()
        .map(|id| {
            parts
                .iter()
                .find(|p| p.id == *id)
                .unwrap_or_else(|| panic!("the part catalogue holds {id}"))
                .name
                .clone()
        })
        .collect();
    assert!(
        expected_names[0].contains("LTR")
            && expected_names[1].starts_with("EF1A")
            && expected_names[10].contains("LTR")
            && expected_names[11].contains("Origin")
            && expected_names[12].starts_with("AmpR"),
        "the documented cassette: {expected_names:?}"
    );

    let result = assemble_modular_custom_vector(&spec);
    let doc = &result.document;
    assert_eq!(
        doc.features.iter().map(|f| f.name.clone()).collect::<Vec<_>>(),
        expected_names,
        "the assembled cassette's parts, in order"
    );
    assert_eq!(doc.topology, Topology::Circular);
    assert_eq!(doc.molecule_type, MoleculeType::DNA);
    for pair in doc.features.windows(2) {
        assert!(
            pair[1].start > pair[0].end,
            "{} ({}-{}) starts after {} ({}-{}) ends",
            pair[1].name,
            pair[1].start,
            pair[1].end,
            pair[0].name,
            pair[0].start,
            pair[0].end
        );
    }
    let last = doc.features.last().expect("the assembled cassette has parts");
    assert!(last.end <= doc.sequence.len(), "every part lies inside the plasmid");
}

#[test]
fn cotransformation_flags_shared_origin_group() {
    let puc_amp = catalog_entry("twist-cmv");
    let puc_kan = catalog_entry("twist-ivt-hbg50a");
    let p15a_chlor = catalog_entry("twist-chlor-med");
    let p15a_amp = catalog_entry("twist-amp-med");
    assert_eq!(
        (
            puc_amp.origin.as_str(),
            puc_amp.bacterial_marker.as_str(),
            puc_kan.origin.as_str(),
            puc_kan.bacterial_marker.as_str(),
        ),
        ("pUC", "Ampicillin", "pUC", "Kanamycin"),
        "the fixture: two pUC vectors with different markers"
    );
    assert_eq!(
        (
            p15a_chlor.origin.as_str(),
            p15a_chlor.bacterial_marker.as_str(),
            p15a_amp.origin.as_str(),
            p15a_amp.bacterial_marker.as_str(),
        ),
        ("p15A", "Chloramphenicol", "p15A", "Ampicillin"),
        "the fixture: two p15A vectors"
    );

    // Same replication control group, orthogonal selection: the origins are the problem.
    let shared = check_cotransformation_compatibility(&puc_amp, &puc_kan);
    assert!(!shared.origin_compatible, "{}", shared.summary);
    assert!(shared.antibiotic_orthogonal, "{}", shared.summary);
    assert!(!shared.compatible);
    assert_eq!(shared.group_a, shared.group_b);
    assert!(
        shared.summary.starts_with("Origin Incompatibility Warning"),
        "{}",
        shared.summary
    );

    // Different groups and different markers: co-maintainable.
    let ok = check_cotransformation_compatibility(&puc_amp, &p15a_chlor);
    assert!(ok.compatible, "{}", ok.summary);
    assert!(ok.origin_compatible && ok.antibiotic_orthogonal);
    assert_ne!(ok.group_a, ok.group_b);

    // Different groups, one marker: the selection is the problem.
    let overlap = check_cotransformation_compatibility(&p15a_amp, &puc_amp);
    assert!(overlap.origin_compatible, "{}", overlap.summary);
    assert!(!overlap.antibiotic_orthogonal, "{}", overlap.summary);
    assert!(!overlap.compatible);
    assert!(
        overlap.summary.starts_with("Selection Overlap"),
        "{}",
        overlap.summary
    );
}

/// One element of a generated SVG: its tag and its `name="value"` attributes, in source order.
struct SvgMark {
    tag: String,
    attrs: Vec<(String, String)>,
}

impl SvgMark {
    fn attr(&self, name: &str) -> Option<&str> {
        self.attrs.iter().find(|(n, _)| n == name).map(|(_, v)| v.as_str())
    }
}

/// Every `<path>`, `<circle>` and `<text>` start tag of `svg`, with its double-quoted attributes.
fn svg_marks(svg: &str) -> Vec<SvgMark> {
    let mut out = Vec::new();
    let mut rest = svg;
    while let Some(open) = rest.find('<') {
        let after = &rest[open + 1..];
        let close = after.find('>').expect("a start tag the SVG never closes");
        let inner = after[..close].trim_end_matches('/');
        rest = &after[close + 1..];
        let tag: String = inner.chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
        if !matches!(tag.as_str(), "path" | "circle" | "text") {
            continue;
        }
        let mut attrs = Vec::new();
        let mut body = &inner[tag.len()..];
        while let Some(eq) = body.find("=\"") {
            let name = body[..eq].trim().to_string();
            let value_start = &body[eq + 2..];
            let end = value_start.find('"').expect("an attribute value the tag never closes");
            attrs.push((name, value_start[..end].to_string()));
            body = &value_start[end + 1..];
        }
        out.push(SvgMark { tag, attrs });
    }
    out
}

/// BG-01M6W099 AC1: the Vectors window's backbone thumbnail names the face the app ships, and
/// gives the ring and each text a class the dark theme restyles, beside the day colour a
/// downloaded Map .svg keeps.
///
/// Wrong implementations this catches: one text left on Inter (the size line, say), a text or the
/// ring with no class, a class that does not name its mark (`-title` on the size line), a day fill
/// dropped for the class (the downloaded .svg would lose its colours), and a part label classed on
/// only the first part. Every catalog entry is drawn, so an entry of any part count reaches it.
#[test]
fn catalog_svg_names_google_sans_and_classes_each_mark() {
    const FACE: &str = "'Google Sans', system-ui, sans-serif";
    let catalog = get_vector_catalog();
    assert!(!catalog.is_empty(), "the vector catalog is empty");
    let mut most_parts = 0;
    for entry in &catalog {
        let svg = generate_catalog_circular_svg(entry);
        assert!(!svg.contains("Inter"), "{}: the thumbnail still names Inter:\n{svg}", entry.id);
        let marks = svg_marks(&svg);
        let rings: Vec<&SvgMark> = marks.iter().filter(|m| m.tag == "circle").collect();
        assert_eq!(rings.len(), 1, "{}: one backbone ring", entry.id);
        assert_eq!(rings[0].attr("class"), Some("mbc-vthumb-ring"), "{}: the ring's class", entry.id);
        assert_eq!(rings[0].attr("stroke"), Some("#CBD5E1"), "{}: the ring keeps its day stroke", entry.id);
        let arcs = marks.iter().filter(|m| m.tag == "path").count();
        let texts: Vec<&SvgMark> = marks.iter().filter(|m| m.tag == "text").collect();
        for t in &texts {
            assert_eq!(t.attr("font-family"), Some(FACE), "{}: a text's font-family", entry.id);
        }
        let classed = |class: &str| -> Vec<Option<&str>> {
            texts.iter().filter(|t| t.attr("class") == Some(class)).map(|t| t.attr("fill")).collect()
        };
        assert_eq!(classed("mbc-vthumb-label"), vec![Some("#334155"); arcs], "{}: one part label per arc, each on its day fill", entry.id);
        assert_eq!(classed("mbc-vthumb-title"), vec![Some("#0F172A")], "{}: the title", entry.id);
        assert_eq!(classed("mbc-vthumb-meta"), vec![Some("#475569")], "{}: the size line", entry.id);
        assert_eq!(classed("mbc-vthumb-source"), vec![Some("#2563EB")], "{}: the source", entry.id);
        assert_eq!(texts.len(), arcs + 3, "{}: no text without one of the four classes", entry.id);
        most_parts = most_parts.max(arcs);
    }
    assert!(most_parts >= 2, "no catalog entry draws more than one part, so a label classed on the first part only would pass");
}
