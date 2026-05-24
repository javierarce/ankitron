export type DiffPart = { char: string; match: boolean };
export type DiffRun = { text: string; match: boolean };

export type TypedAnswerDiff = {
  typed: DiffPart[];
  expected: DiffPart[];
  correct: boolean;
};

export function groupRuns(parts: DiffPart[]): DiffRun[] {
  const runs: DiffRun[] = [];
  for (const p of parts) {
    const last = runs[runs.length - 1];
    if (last && last.match === p.match) {
      last.text += p.char;
    } else {
      runs.push({ text: p.char, match: p.match });
    }
  }
  return runs;
}

export function diffTypedAnswer(typed: string, expected: string): TypedAnswerDiff {
  const n = typed.length;
  const m = expected.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (typed[i - 1].toLowerCase() === expected[j - 1].toLowerCase()) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const typedOut: DiffPart[] = [];
  const expectedOut: DiffPart[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (typed[i - 1].toLowerCase() === expected[j - 1].toLowerCase()) {
      typedOut.push({ char: typed[i - 1], match: true });
      expectedOut.push({ char: expected[j - 1], match: true });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      typedOut.push({ char: typed[i - 1], match: false });
      i--;
    } else {
      expectedOut.push({ char: expected[j - 1], match: false });
      j--;
    }
  }
  while (i > 0) {
    typedOut.push({ char: typed[i - 1], match: false });
    i--;
  }
  while (j > 0) {
    expectedOut.push({ char: expected[j - 1], match: false });
    j--;
  }
  typedOut.reverse();
  expectedOut.reverse();

  return {
    typed: typedOut,
    expected: expectedOut,
    correct: typed.toLowerCase() === expected.toLowerCase(),
  };
}

// The question shows the targeted cloze as `[...]` and any other clozes revealed.
// The answer reveals all clozes. We find the question span whose text contains `[`
// and return the corresponding revealed span from the answer.
export function extractExpectedClozeAnswer(
  questionHtml: string,
  answerHtml: string
): string {
  if (typeof DOMParser === "undefined") return "";
  const parser = new DOMParser();
  const qDoc = parser.parseFromString(questionHtml, "text/html");
  const aDoc = parser.parseFromString(answerHtml, "text/html");
  const qSpans = Array.from(qDoc.querySelectorAll("span.cloze"));
  const aSpans = Array.from(aDoc.querySelectorAll("span.cloze"));
  for (let i = 0; i < qSpans.length; i++) {
    const qText = qSpans[i].textContent ?? "";
    if (qText.includes("[")) {
      return (aSpans[i]?.textContent ?? "").trim();
    }
  }
  return (aSpans[0]?.textContent ?? "").trim();
}
