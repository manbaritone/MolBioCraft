// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Reader for **SCF** (Staden Standard Chromatogram Format, versions 2.x and 3.x), the open trace
//! format written by many capillary sequencers and by the Staden package.
//!
//! Nothing is synthesized: values that are absent from a file are reported as absent.

use molbiocraft_core::ChromatogramData;

fn be_u32(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 4).map(|s| u32::from_be_bytes([s[0], s[1], s[2], s[3]]))
}

/// Parsed SCF trace plus the free-text comment block (`NAME=…`, `MACH=…`, …).
#[derive(Debug, Clone)]
pub struct ScfTrace {
    pub chromatogram: ChromatogramData,
    pub comments: Vec<(String, String)>,
    pub version: String,
}

/// Parses an SCF v2/v3 chromatogram. Sample deltas (v3) are decoded exactly as in the Staden
/// `io_lib` reference implementation; per-base quality is the called base's probability value.
pub fn parse_scf_chromatogram(bytes: &[u8]) -> Option<ScfTrace> {
    if bytes.len() < 128 || &bytes[0..4] != b".scf" {
        return None;
    }
    let samples = be_u32(bytes, 4)? as usize;
    let samples_offset = be_u32(bytes, 8)? as usize;
    let bases = be_u32(bytes, 12)? as usize;
    let bases_offset = be_u32(bytes, 24)? as usize;
    let comments_size = be_u32(bytes, 28)? as usize;
    let comments_offset = be_u32(bytes, 32)? as usize;
    let version = String::from_utf8_lossy(&bytes[36..40]).trim_matches('\0').to_string();
    let sample_size = be_u32(bytes, 40)? as usize;
    if !(sample_size == 1 || sample_size == 2) || samples > 5_000_000 || bases > 200_000 {
        return None;
    }
    let is_v3 = version.as_bytes().first().copied().unwrap_or(b'0') >= b'3';

    let read_sample = |idx: usize| -> Option<u32> {
        let at = samples_offset + idx * sample_size;
        if sample_size == 2 {
            bytes.get(at..at + 2).map(|s| u16::from_be_bytes([s[0], s[1]]) as u32)
        } else {
            bytes.get(at).map(|&v| v as u32)
        }
    };

    // channels[0..4] = A, C, G, T
    let mut channels: [Vec<f64>; 4] = [Vec::new(), Vec::new(), Vec::new(), Vec::new()];
    if is_v3 {
        let mask: u32 = if sample_size == 2 { 0xFFFF } else { 0xFF };
        for (ch, channel) in channels.iter_mut().enumerate() {
            let mut raw: Vec<u32> = (0..samples)
                .map(|i| read_sample(ch * samples + i))
                .collect::<Option<Vec<_>>>()?;
            // Undo the two rounds of delta encoding (wrapping arithmetic at the sample width).
            for _ in 0..2 {
                let mut prev = 0u32;
                for v in raw.iter_mut() {
                    *v = (*v + prev) & mask;
                    prev = *v;
                }
            }
            *channel = raw.into_iter().map(|v| v as f64).collect();
        }
    } else {
        for i in 0..samples {
            for (ch, channel) in channels.iter_mut().enumerate() {
                channel.push(read_sample(i * 4 + ch)? as f64);
            }
        }
    }

    let mut peak_locations = Vec::with_capacity(bases);
    let mut phred_scores = Vec::with_capacity(bases);
    let mut base_calls = String::with_capacity(bases);
    for i in 0..bases {
        let (peak, probs, base) = if is_v3 {
            let peak = be_u32(bytes, bases_offset + 4 * i)?;
            let p = |k: usize| bytes.get(bases_offset + 4 * bases + k * bases + i).copied();
            let probs = [p(0)?, p(1)?, p(2)?, p(3)?];
            let base = *bytes.get(bases_offset + 8 * bases + i)?;
            (peak, probs, base)
        } else {
            let at = bases_offset + 12 * i;
            let rec = bytes.get(at..at + 12)?;
            let peak = u32::from_be_bytes([rec[0], rec[1], rec[2], rec[3]]);
            (peak, [rec[4], rec[5], rec[6], rec[7]], rec[8])
        };
        let b = (base as char).to_ascii_uppercase();
        let q = match b {
            'A' => probs[0],
            'C' => probs[1],
            'G' => probs[2],
            'T' | 'U' => probs[3],
            _ => *probs.iter().max().unwrap_or(&0),
        };
        peak_locations.push(peak as usize);
        phred_scores.push(q.min(93));
        base_calls.push(if b.is_ascii_alphabetic() { b } else { 'N' });
    }

    let comments = bytes
        .get(comments_offset..comments_offset.saturating_add(comments_size).min(bytes.len()))
        .map(|c| {
            String::from_utf8_lossy(c)
                .lines()
                .filter_map(|l| {
                    let (k, v) = l.split_once('=')?;
                    Some((k.trim().to_string(), v.trim_matches('\0').trim().to_string()))
                })
                .collect()
        })
        .unwrap_or_default();

    let [trace_a, trace_c, trace_g, trace_t] = channels;
    Some(ScfTrace {
        chromatogram: ChromatogramData {
            trace_a,
            trace_c,
            trace_g,
            trace_t,
            peak_locations,
            phred_scores,
            base_calls,
        },
        comments,
        version,
    })
}
