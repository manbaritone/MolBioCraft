"""PyDESeq2 reference for the pasilla RNA-seq count table (treated vs untreated, design ~condition).
Writes test-data/reference/deseq2_pasilla.json."""
import json, sys, warnings
import numpy as np, pandas as pd
from pydeseq2.dds import DeseqDataSet
from pydeseq2.ds import DeseqStats
warnings.filterwarnings('ignore')
T = sys.argv[1] if len(sys.argv) > 1 else 'test-data'
counts = pd.read_csv(f'{T}/pasilla/pasilla_gene_counts.tsv', sep='\t', index_col=0)
ann = pd.read_csv(f'{T}/pasilla/pasilla_sample_annotation.csv', index_col=0)
ann.index = [i.replace('fb', '') for i in ann.index]
ann = ann.loc[counts.columns]
X = counts.T
X = X.loc[:, X.sum(axis=0) >= 10]
dds = DeseqDataSet(counts=X, metadata=ann[['condition']], design='~condition', refit_cooks=True, quiet=True)
dds.deseq2()
st = DeseqStats(dds, contrast=['condition', 'treated', 'untreated'], quiet=True)
st.summary()
r = st.results_df
out = {
    'samples': list(counts.columns), 'condition': list(ann['condition']),
    'size_factors': dict(zip(X.index, map(float, dds.obs['size_factors'] if 'size_factors' in dds.obs else dds.obsm['size_factors']))),
    'genes': {g: {k: (None if pd.isna(v) else float(v)) for k, v in row.items()} for g, row in r.iterrows()},
    'dispersions': dict(zip(X.columns, map(float, dds.var['dispersions']))),
}
json.dump(out, open(f'{T}/reference/deseq2_pasilla.json', 'w'))
print('genes', len(out['genes']), 'padj<0.1:', int((r['padj'] < 0.1).sum()), 'sf', out['size_factors'])
