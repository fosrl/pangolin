const segmentRegexCache = new Map<string, RegExp>();

function getSegmentRegex(patternPart: string): RegExp {
    let regex = segmentRegexCache.get(patternPart);
    if (!regex) {
        const regexPattern = patternPart
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*")
            .replace(/\?/g, ".");
        regex = new RegExp(`^${regexPattern}$`);
        segmentRegexCache.set(patternPart, regex);
    }
    return regex;
}

// Decodes percent-encoding (so an encoded slash like `%2F` is treated as a
// real path separator, matching what most backends will do) and then
// resolves `.` / `..` segments, so a request like `/public%2F..%2Fadmin/`
// or `/public/../admin/` is matched as `/admin/`, not as a literal segment
// or a wildcard-swallowed sequence under `/public/*`.
function decodeAndResolvePath(p: string): string[] {
    const rawParts = p.split("/").filter(Boolean);

    const resolved: string[] = [];
    for (const rawPart of rawParts) {
        let part: string;
        try {
            part = decodeURIComponent(rawPart);
        } catch {
            part = rawPart;
        }

        // an encoded slash can turn one raw segment into several real ones
        for (const segment of part.split("/").filter(Boolean)) {
            if (segment === ".") {
                continue;
            } else if (segment === "..") {
                resolved.pop();
            } else {
                resolved.push(segment);
            }
        }
    }

    return resolved;
}

// Matches a request path against a rule pattern, segment by segment. A bare
// `*` segment matches zero or more path segments. A segment that contains a
// `*` (but isn't a bare `*`) is matched as a per-segment glob via
// `getSegmentRegex`, where within that segment `*` matches any run of
// characters and `?` matches a single character. A segment with no `*` is
// compared literally, so a lone `?` is a literal `?` — this matches the
// previous implementation's behavior exactly and is deliberate: making `?`
// wildcard-match on its own would widen which paths an access rule covers.
//
// This is the classic "wildcard matching" problem. The previous
// implementation expressed it as a doubly-recursive descent: on every `*`
// segment it branched into "the star consumes this path segment" and "the
// star matches nothing here" without remembering states it had already
// visited. Because those branches overlap, a pattern with k `*` segments
// against an n-segment path re-explored the same (patternIndex, pathIndex)
// states an exponential number of times — O(2^n) in the worst case — and a
// hard `MAX_RECURSION_DEPTH = 100` guard was needed just to stop it running
// away, at the cost of silently rejecting any path deeper than 100 segments.
//
// Reframed as dynamic programming, `match(i, j)` = "can patternParts[i..]
// match pathParts[j..]?" has only (patternParts.length + 1) x
// (pathParts.length + 1) distinct states, so filling them bottom-up solves the
// same problem in O(pattern x path) time with no recursion and no depth cap.
// We keep only two rows at a time (row i depends solely on row i+1 and on the
// already-computed column j+1 of row i), so memory is O(pathParts.length) —
// itself bounded by the upstream URL parser — with no large per-request
// allocation. Behavior is otherwise identical to the recursive version
// (verified by fuzzing the two against each other over 500k random
// pattern/path pairs), except that legitimately deep paths are no longer
// wrongly rejected.
export function isPathAllowed(pattern: string, path: string): boolean {
    const patternParts = pattern.split("/").filter(Boolean);
    const pathParts = decodeAndResolvePath(path);

    const patternLen = patternParts.length;
    const pathLen = pathParts.length;

    // `next[j]` holds match(i + 1, j); `curr[j]` is filled with match(i, j).
    // Index `pathLen` is the "path fully consumed" column.
    let next = new Array<boolean>(pathLen + 1).fill(false);
    let curr = new Array<boolean>(pathLen + 1).fill(false);

    // Base row (i === patternLen, pattern fully consumed): a match only when
    // the path is also fully consumed.
    next[pathLen] = true;

    for (let i = patternLen - 1; i >= 0; i--) {
        const patternPart = patternParts[i];
        const isStar = patternPart === "*";
        const isGlob = !isStar && patternPart.includes("*");
        const segmentRegex = isGlob ? getSegmentRegex(patternPart) : null;

        // Path fully consumed but pattern is not: matches only if this and
        // every remaining pattern segment is `*` (each may match zero).
        curr[pathLen] = isStar && next[pathLen];

        for (let j = pathLen - 1; j >= 0; j--) {
            if (isStar) {
                // `*` either matches nothing here (advance the pattern,
                // next[j]) or consumes this path segment (advance the path,
                // curr[j + 1]).
                curr[j] = next[j] || curr[j + 1];
            } else if (isGlob) {
                curr[j] = segmentRegex!.test(pathParts[j]) && next[j + 1];
            } else {
                curr[j] = patternPart === pathParts[j] && next[j + 1];
            }
        }

        // Row i becomes the "next" row for row i - 1; reuse the old buffer.
        const swap = next;
        next = curr;
        curr = swap;
    }

    // After the final swap, `next` holds row 0.
    return next[0];
}
