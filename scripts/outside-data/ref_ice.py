"""Synthego ICE (v1.2) reference analyses of the ICE test traces (control vs edited, guide,
optional donor). Writes test-data/reference/ice.json. Run with an environment that has
synthego-ice installed (see README.md)."""
import json, os, sys, tempfile, contextlib, io
from ice.analysis import single_sanger_analysis
T = sys.argv[1] if len(sys.argv) > 1 else 'test-data'
D = f'{T}/synthego-ice'
cases = [
    ('good_example', 'good_example_control', 'good_example_edited', 'AACCAGTTGCAGGCGCCCCA', None),
    ('donor_example', 'donor_example_control', 'donor_example_knockin', 'AAGTGCAGCTCGTCCGGCGT', 'ATCCTCCCGGGAACGTCTCCACCAGCTTCCCTTCCAGCCGACGAGATTGATCTCCGACCCGACGAGCTGCACTTCCTGTCCAAGCACTTCCGCAGCTCAGAGAA'),
    ('donor_sub_example', 'donor_sub_example_control', 'donor_sub_example_edited', 'GCTGCTTCCTGGGGGCGCCT', 'AGCCTCAGGGCCTCACACCAGCCCATGTGGATGACCTGAGGGTCCTGTTTCCCATCCCACttCAGGCGCCCCCAGGAAGCAGCGGCGGGAGCGCACCACCTTCACCCGGAGCCAACTGGAGG'),
    ('multiplex0_g0', 'multiplex0_control', 'multiplex0_edited', 'UGCCAGGAUCACCUCCGAGA', None),
    ('multiplex0_g1', 'multiplex0_control', 'multiplex0_edited', 'CGAUAGGGGGGCCUUCUCGG', None),
]
out = {}
for name, c, e, guide, donor in cases:
    with tempfile.TemporaryDirectory() as d, contextlib.redirect_stdout(io.StringIO()):
        args = (f'{D}/{c}.ab1', f'{D}/{e}.ab1', f'{d}/out', guide) + ((donor,) if donor else ())
        r = single_sanger_analysis(*args, verbose=False)
        p = f'{d}/out.indel.json'
        indels = json.load(open(p)) if os.path.exists(p) else None
        files = sorted(os.listdir(d))
    keep = {k: r.get(k) for k in ('status', 'ice', 'ice_d', 'r_sq', 'hdr_pct', 'ko_score', 'guides', 'notes')}
    keep['control'], keep['edited'], keep['guide'], keep['donor'] = c, e, guide, donor
    keep['indels'], keep['files'] = indels, files
    out[name] = keep
    print(name, {k: keep[k] for k in ('ice', 'ice_d', 'r_sq', 'hdr_pct', 'ko_score')})
json.dump(out, open(f'{T}/reference/ice.json', 'w'), default=str)
