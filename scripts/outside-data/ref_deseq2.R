# Bioconductor DESeq2 reference on the pasilla counts (treated vs untreated, design ~condition).
# Writes test-data/reference/deseq2_R_pasilla.json.
suppressPackageStartupMessages({ library(DESeq2); library(jsonlite) })
args <- commandArgs(trailingOnly = TRUE); T <- if (length(args)) args[1] else "test-data"
cts <- as.matrix(read.delim(file.path(T, "pasilla/pasilla_gene_counts.tsv"), row.names = "gene_id"))
cond <- factor(ifelse(grepl("^untreated", colnames(cts)), "untreated", "treated"), levels = c("untreated", "treated"))
cts <- cts[rowSums(cts) >= 10, ]
dds <- DESeqDataSetFromMatrix(cts, data.frame(condition = cond, row.names = colnames(cts)), ~condition)
dds <- DESeq(dds, quiet = TRUE)
res <- results(dds, contrast = c("condition", "treated", "untreated"), alpha = 0.1)
df <- as.data.frame(res)
out <- list(
  size_factors = as.list(sizeFactors(dds)),
  trend = attr(dispersionFunction(dds), "coefficients"),
  prior_var = attr(dispersionFunction(dds), "dispPriorVar"),
  genes = lapply(split(df, rownames(df)), function(r) list(baseMean = r$baseMean, log2FoldChange = r$log2FoldChange, lfcSE = r$lfcSE, pvalue = r$pvalue, padj = r$padj)),
  dispersions = as.list(setNames(dispersions(dds), rownames(dds))),
  genewise = as.list(setNames(mcols(dds)$dispGeneEst, rownames(dds))),
  filter_threshold = metadata(res)$filterThreshold
)
write_json(out, file.path(T, "reference/deseq2_R_pasilla.json"), digits = NA, auto_unbox = TRUE, na = "null")
cat("ok", sum(df$padj < 0.1, na.rm = TRUE), "trend", out$trend, "prior", out$prior_var, "\n")
