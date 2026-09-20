# ADR 003: exact quotes fail closed

Accepted. Quotes must be nonempty character-for-character substrings of their respective original inputs. No punctuation normalization, whitespace repair, fuzzy matching, or case folding is allowed. The provider gets one retry with stricter instructions. A second failure returns a typed error, records an AI failure and creates neither a review nor a knowledge change. Relation classification can only propose human review; it cannot establish truth.
