# /code-review

Comprehensive code and PR review.

## Review Dimensions

For every review, cover all applicable dimensions:

### 1. Correctness
- Does the logic do what it claims?
- Are edge cases handled? (null, empty, overflow, concurrency)
- Is error handling appropriate (not swallowing errors silently)?
- Are async operations handled correctly?

### 2. Security (mandatory)
- Input validation at system boundaries
- SQL injection, XSS, command injection
- Authentication and authorization checks
- Secrets in code or logs
- Dependency vulnerabilities

### 3. Simplicity
- Is this the simplest implementation that works?
- Is there dead code, redundant logic, or unnecessary abstraction?
- Are there 3+ similar patterns that should be extracted?
- Is the code readable without comments?

### 4. Performance
- Any obvious O(n²) or worse where O(n) is straightforward?
- Unnecessary database queries in loops?
- Large allocations that could be avoided?

### 5. Tests
- Are the happy paths tested?
- Are error cases tested?
- Are edge cases tested?
- Do tests test behavior or implementation?

## Output Format

```
## Code Review: {scope}

### Summary
{2-3 sentence overall assessment}

### Critical Issues (blocking)
- [CRITICAL] {file}:{line} — {issue} — {fix}

### Improvements (non-blocking)
- [IMPROVE] {file}:{line} — {suggestion}

### Nits (optional)
- [NIT] {file}:{line} — {minor style/clarity note}

### Security Notes
{security findings or "No security concerns found."}

### Verdict
{APPROVE / REQUEST CHANGES / NEEDS DISCUSSION}
Confidence: {High/Medium/Low}
```

## Scope Control

- `/code-review` — review the current diff
- `/code-review --file <path>` — review a specific file
- `/code-review --pr` — review the PR description + diff
- `/code-review --security` — security-focused review only

## Rules

- Be specific: file name + line number for every finding
- Distinguish blocking from non-blocking issues
- Explain the "why" not just the "what" for each finding
- Don't comment on style if linters exist for it
- Don't nitpick things that don't matter
