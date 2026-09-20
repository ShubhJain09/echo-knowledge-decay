# ADR 001: provider-independent comparisons

Accepted. `compareKnowledge` owns the normalized comparison contract. Groq and Bedrock only transport requests; schema and quote checks remain provider-independent. The retry budget belongs to the contract, so swapping providers cannot bypass validation. Groq is the default configured production provider. Bedrock requires an explicit runtime-verification flag. Demo rules are a separate, labeled offline rehearsal mode and are not an LLM adapter.
