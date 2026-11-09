// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! BAM (SAM/BAM format specification v1, section 4) decoded to SAM text, so a BAM file imports
//! through the same SAM path (reference contig from POS / CIGAR). BGZF blocks are ordinary gzip
//! members, read with a multi-member gzip decoder. Optional tag fields are not converted (the
//! importer does not use them).

use flate2::read::MultiGzDecoder;
use std::io::Read;

struct Cursor<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> Cursor<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self.i.checked_add(n).filter(|&e| e <= self.b.len()).ok_or("BAM data ends early")?;
        let s = &self.b[self.i..end];
        self.i = end;
        Ok(s)
    }
    fn i32(&mut self) -> Result<i32, String> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn u16(&mut self) -> Result<u16, String> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }
}

fn nul_str(b: &[u8]) -> String {
    let end = b.iter().position(|&c| c == 0).unwrap_or(b.len());
    String::from_utf8_lossy(&b[..end]).into_owned()
}

/// Decompresses a BAM file and writes it as SAM text (header, then one line per record).
/// `max_records` caps the records written (0 = all).
pub fn bam_to_sam_text(bytes: &[u8], max_records: usize) -> Result<String, String> {
    if bytes.len() < 18 || bytes[0] != 0x1f || bytes[1] != 0x8b {
        return Err("Not a BAM file (no BGZF / gzip header).".into());
    }
    let mut raw = Vec::with_capacity(bytes.len() * 4);
    MultiGzDecoder::new(bytes).read_to_end(&mut raw).map_err(|e| format!("BAM decompression failed: {e}"))?;
    let mut c = Cursor { b: &raw, i: 0 };
    if c.take(4)? != b"BAM\x01" {
        return Err("Not a BAM file (missing BAM\\1 magic).".into());
    }
    let l_text = c.i32()?.max(0) as usize;
    let header = nul_str(c.take(l_text)?);
    let n_ref = c.i32()?.max(0) as usize;
    let mut refs: Vec<(String, i32)> = Vec::with_capacity(n_ref);
    for _ in 0..n_ref {
        let l_name = c.i32()?.max(0) as usize;
        let name = nul_str(c.take(l_name)?);
        let len = c.i32()?;
        refs.push((name, len));
    }

    let mut out = String::with_capacity(raw.len() * 2);
    let header = header.trim_end_matches('\n');
    if !header.is_empty() {
        out.push_str(header);
        out.push('\n');
    }
    // a header without @SQ lines still has the binary reference list
    if !header.lines().any(|l| l.starts_with("@SQ")) {
        for (name, len) in &refs {
            out.push_str(&format!("@SQ\tSN:{name}\tLN:{len}\n"));
        }
    }
    let ref_name = |id: i32| -> &str {
        if id < 0 {
            "*"
        } else {
            refs.get(id as usize).map(|r| r.0.as_str()).unwrap_or("*")
        }
    };

    const CIGAR_OPS: &[u8; 9] = b"MIDNSHP=X";
    const SEQ_CODES: &[u8; 16] = b"=ACMGRSVTWYHKDBN";
    let mut written = 0usize;
    while c.i + 4 <= raw.len() {
        let block_size = c.i32()?.max(0) as usize;
        let rec = c.take(block_size)?;
        let mut r = Cursor { b: rec, i: 0 };
        let ref_id = r.i32()?;
        let pos = r.i32()?;
        let l_read_name = r.u8()? as usize;
        let mapq = r.u8()?;
        let _bin = r.u16()?;
        let n_cigar = r.u16()? as usize;
        let flag = r.u16()?;
        let l_seq = r.i32()?.max(0) as usize;
        let next_ref = r.i32()?;
        let next_pos = r.i32()?;
        let tlen = r.i32()?;
        let qname = nul_str(r.take(l_read_name)?);
        let mut cigar = String::new();
        for _ in 0..n_cigar {
            let v = r.u32()?;
            cigar.push_str(&(v >> 4).to_string());
            cigar.push(CIGAR_OPS.get((v & 0xf) as usize).copied().unwrap_or(b'M') as char);
        }
        if cigar.is_empty() {
            cigar.push('*');
        }
        let packed = r.take(l_seq.div_ceil(2))?;
        let seq: String = if l_seq == 0 {
            "*".into()
        } else {
            (0..l_seq)
                .map(|k| {
                    let byte = packed[k / 2];
                    let code = if k % 2 == 0 { byte >> 4 } else { byte & 0xf };
                    SEQ_CODES[code as usize] as char
                })
                .collect()
        };
        let q = r.take(l_seq)?;
        let qual: String = if l_seq == 0 || q[0] == 0xff {
            "*".into()
        } else {
            q.iter().map(|&v| (v.min(93) + 33) as char).collect()
        };
        let rnext = if next_ref < 0 {
            "*".to_string()
        } else if next_ref == ref_id {
            "=".to_string()
        } else {
            ref_name(next_ref).to_string()
        };
        out.push_str(&format!(
            "{qname}\t{flag}\t{}\t{}\t{mapq}\t{cigar}\t{rnext}\t{}\t{tlen}\t{seq}\t{qual}\n",
            ref_name(ref_id),
            pos + 1,
            next_pos + 1,
        ));
        written += 1;
        if max_records > 0 && written >= max_records {
            break;
        }
    }
    Ok(out)
}
