# Reference results for distances, trees, parsimony, likelihood and neutrality statistics on the
# MrBayes primate mtDNA alignment (ape / phangorn / pegas). Writes test-data/reference/phylo_r.json.
suppressPackageStartupMessages({ library(ape); library(phangorn); library(pegas); library(jsonlite) })
args <- commandArgs(trailingOnly = TRUE); T <- if (length(args)) args[1] else "test-data"
x <- read.nexus.data(file.path(T, "mrbayes/primates.nex"))
seqs <- sapply(x, function(s) toupper(paste(s, collapse = "")))
dna <- as.matrix(as.DNAbin(x))
out <- list(names = names(seqs), seqs = unname(seqs))
d <- list()
for (m in c("raw", "JC69", "K80", "T92", "TN93", "F84", "logdet")) d[[m]] <- unname(as.matrix(dist.dna(dna, model = m, pairwise.deletion = TRUE)))
out$dist <- d
nj_k80 <- nj(dist.dna(dna, model = "K80", pairwise.deletion = TRUE))
out$nj_k80 <- write.tree(nj_k80)
out$bionj_k80 <- write.tree(bionj(dist.dna(dna, model = "K80", pairwise.deletion = TRUE)))
out$upgma_jc <- write.tree(phangorn::upgma(dist.dna(dna, model = "JC69", pairwise.deletion = TRUE)))
pd <- phyDat(dna)
out$fitch_nj <- parsimony(nj_k80, pd, method = "fitch")
set.seed(1)
best_mp <- pratchet(pd, trace = 0, minit = 50, k = 20)
out$mp_best <- parsimony(best_mp, pd)
out$mp_best_tree <- write.tree(unroot(best_mp))
lk <- list()
tr <- nj_k80; tr$edge.length[tr$edge.length < 1e-8] <- 1e-8
for (m in list(c("JC", 1), c("K80", 1), c("HKY", 1), c("GTR", 1), c("GTR", 4), c("HKY", 4))) {
  k <- as.integer(m[2])
  fit <- pml(tr, pd, k = k)
  fit <- optim.pml(fit, model = m[1], optGamma = k > 1, optEdge = TRUE, optBf = m[1] %in% c("HKY", "GTR"), optQ = m[1] != "JC", rearrangement = "none", control = pml.control(trace = 0))
  lk[[paste0(m[1], if (k > 1) "+G4" else "")]] <- list(logLik = fit$logLik, alpha = fit$shape, length = sum(fit$tree$edge.length))
}
out$pml_on_nj <- lk
out$tajima <- unname(tajima.test(dna)[c("D", "Pval.normal", "Pval.beta")])
out$nuc_div <- nuc.div(dna)
out$theta_s <- theta.s(length(seg.sites(dna)), nrow(dna))
out$seg_sites <- length(seg.sites(dna))
# strict molecular clock: TN93+G4 on the midpoint-rooted NJ (TN93) tree, node heights optimised
nj_tn <- midpoint(nj(dist.dna(dna, model = "TN93", pairwise.deletion = TRUE)))
nj_tn$edge.length[nj_tn$edge.length < 1e-6] <- 1e-6
out$nj_tn93_midpoint <- write.tree(nj_tn)
free <- optim.pml(pml(unroot(nj_tn), pd, k = 4), model = "TrN", optGamma = TRUE, optBf = TRUE, optQ = TRUE, optEdge = TRUE, rearrangement = "none", control = pml.control(trace = 0))
clk <- optim.pml(pml(nj_tn, pd, k = 4), model = "TrN", optGamma = TRUE, optBf = TRUE, optQ = TRUE, optRooted = TRUE, optEdge = TRUE, rearrangement = "none", control = pml.control(trace = 0))
out$clock <- list(free = free$logLik, clock = clk$logLik, free_alpha = free$shape)
# complete deletion (columns with a gap or ambiguity removed)
ch <- as.character(dna)
keep <- apply(ch, 2, function(col) all(col %in% c("a", "c", "g", "t")))
cd <- dna[, keep]
out$complete_deletion <- list(sites = sum(keep), seg_sites = length(seg.sites(cd)), nuc_div = nuc.div(cd),
  theta_s = theta.s(length(seg.sites(cd)), nrow(cd)), tajima = unname(tajima.test(cd)[c("D", "Pval.normal", "Pval.beta")]))
write_json(out, file.path(T, "reference/phylo_r.json"), digits = NA, auto_unbox = TRUE)
cat("ok\n")
