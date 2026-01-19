# Benchmark Questions - Latent-K

## Project Context

| Metric | Value |
|--------|-------|
| **Total files** | 6,596 |
| **.lk domains** | 4 |
| **.lk context** | 12 KB |
| **Tokens** | ~2,086 |
| **Characters** | 7,301 |

## Results

| # | Level | LK | No-LK | Question |
|---|-------|-----|-------|----------|
| 1 | High | 00:49 | 01:55 | How does data flow from project file parsing to .lk context generation? |
| 2 | High | 00:27 | 01:14 | What are the differences between Claude Code and Gemini CLI integration? |
| 3 | High | 02:10 | 01:40 | How does the hooks system work and how does it integrate with AI assistants? |
| 4 | High | 00:53 | 01:26 | What strategies does the parser use to classify files into domains? |
| 5 | Medium | 00:50 | 01:27 | What information does the parser extract from each file and how is it structured? |
| 6 | Medium | 00:30 | 00:40 | How does the sync command work and what steps does it execute? |
| 7 | Medium | 00:43 | 00:33 | How is synchronization state managed in state.json? |
| 8 | Medium | 00:54 | 00:38 | How is the project.lk file structured and what does it contain? |
| 9 | Low | 00:26 | 00:36 | What CLI commands does the project expose? |
| 10 | Low | 00:45 | 01:03 | Where are generated context files stored? |
| 11 | Low | 00:13 | 00:38 | What are the main project dependencies? |
| 12 | Low | 00:38 | 00:37 | How do you run latent-k in development mode? |
| 13 | Trivial | 00:28 | 00:34 | What is the project version? |
| 14 | Trivial | 00:28 | 01:06 | What AI models does the system support? |
| 15 | Trivial | 00:28 | 00:37 | What is the command to view sync status? |

## Summary

### Totals

| Metric | LK | No-LK | Difference |
|--------|-----|-------|------------|
| **Total time** | 10:42 | 14:44 | -04:02 |
| **Average/question** | 00:43 | 00:59 | -00:16 |
| **Wins** | 11 | 4 | +7 |

**LK is 1.38x faster on average**

### By Complexity Level

| Level | LK Total | No-LK Total | LK Average | No-LK Average | Ratio |
|-------|----------|-------------|------------|---------------|-------|
| High (1-4) | 04:19 | 06:15 | 01:05 | 01:34 | 1.45x |
| Medium (5-8) | 02:57 | 03:18 | 00:44 | 00:50 | 1.12x |
| Low (9-12) | 02:02 | 02:54 | 00:31 | 00:44 | 1.43x |
| Trivial (13-15) | 01:24 | 02:17 | 00:28 | 00:46 | 1.63x |

### Conclusions

- **Greatest benefit**: **Trivial** level questions (1.63x faster)
- **Least benefit**: **Medium** level questions (1.12x faster)
- **Consistency**: LK won 11/15 questions (73%)
- **Total savings**: 4 minutes 2 seconds across 15 questions
