# ADR 004: isolate citations and use extractive answers

Accepted. Citation parsing lives in one pure, tested module. It recognizes bracketed references and rejects malformed, missing, nonexistent, archived and malicious references. Each answer paragraph must end with valid citations and cited IDs must match referenced positions. Citation numbers retain the retrieval order.

The answer layer quotes current verified statements directly, so all returned factual content is traceable to a source. Citation validation checks structure, not semantic truth. This delivery avoids free-form LLM synthesis rather than claiming a parser can prove generated claims. Expired and future-valid knowledge is excluded.
