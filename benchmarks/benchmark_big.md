# Benchmark Questions - Enterprise DocFlow Platform

## Project Context

| Metric | Value |
|--------|-------|
| **Total files** | 27,985 |
| **.lk domains** | 26 |
| **.lk context** | 100 KB |
| **Tokens** | ~18,980 |
| **Characters** | 66,427 |

## Results

| # | Level | LK | No-LK | Question |
|---|-------|-----|-------|----------|
| 1 | High | 00:25 | 02:32 | How does data flow from PDF upload to final compliance report generation? |
| 2 | High | 00:55 | 01:35 | What are the differences between Gemini API and Azure OpenAI processing? |
| 3 | High | 01:01 | 01:49 | How does the system integrate with the external ERP API and what data is synchronized? |
| 4 | High | 01:29 | 02:06 | What error handling and retry strategies does the AI layer implement? |
| 5 | Medium | 01:06 | 01:03 | What fields does the system extract from Documents and how are they validated? |
| 6 | Medium | 01:10 | 01:06 | How does the label validation process work in label/ia/ia.py? |
| 7 | Medium | 00:18 | 00:32 | What management command runs AI on products with errors? |
| 8 | Medium | 00:59 | 00:32 | How is the Document model structured and what relationships does it have? |
| 9 | Low | 00:15 | 00:45 | What API endpoints does the doc_reader module expose? |
| 10 | Low | 00:19 | 01:25 | Where are uploaded files stored (Azure Blob Storage)? |
| 11 | Low | 00:33 | 00:23 | What are the main dependencies according to settings/base.py? |
| 12 | Low | 00:14 | 00:20 | How do you run the development server? |
| 13 | Trivial | 00:13 | 00:18 | What is the project version? |
| 14 | Trivial | 00:15 | 00:23 | What OCR engine does the system use? |
| 15 | Trivial | 00:14 | 00:23 | What is the command to generate a report PDF? |

## Summary

### Totals

| Metric | LK | No-LK | Difference |
|--------|-----|-------|------------|
| **Total time** | 09:26 | 15:12 | -05:46 |
| **Average/question** | 00:38 | 01:01 | -00:23 |
| **Wins** | 11 | 4 | +7 |

**LK is 1.61x faster on average**

### By Complexity Level

| Level | LK Total | No-LK Total | LK Average | No-LK Average | Ratio |
|-------|----------|-------------|------------|---------------|-------|
| High (1-4) | 03:50 | 08:02 | 00:58 | 02:01 | 2.1x |
| Medium (5-8) | 03:33 | 03:13 | 00:53 | 00:48 | 0.9x |
| Low (9-12) | 01:21 | 02:53 | 00:20 | 00:43 | 2.1x |
| Trivial (13-15) | 00:42 | 01:04 | 00:14 | 00:21 | 1.5x |

### Conclusions

- **Greatest benefit**: **High** and **Low** level questions (2.1x faster)
- **Medium level**: LK slightly slower (0.9x), possibly due to unnecessary context overhead
- **Consistency**: LK won 11/15 questions (73%)
- **Total savings**: 5 minutes 46 seconds across 15 questions
