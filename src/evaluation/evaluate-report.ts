import {
  extractUrls,
  parseResearchReport,
} from "../schemas/research-report.js";

export interface EvaluationCase {
  name: string;
  expectedTerms: string[];
  requiresSources: boolean;
}

export interface EvaluationResult {
  passed: boolean;
  checks: {
    format: boolean;
    expectedTerms: boolean;
    sources: boolean;
    citationsVerified: boolean;
  };
  unverifiedUrls: string[];
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href.replace(/\/$/, "");
  } catch {
    return url;
  }
}

export function findUnverifiedUrls(
  answer: string,
  knownUrls: Iterable<string>,
): string[] {
  const known = new Set([...knownUrls].map(normalizeUrl));
  return extractUrls(answer).filter((url) => !known.has(normalizeUrl(url)));
}

export function evaluateReport(
  answer: string,
  testCase: EvaluationCase,
  knownUrls: Iterable<string> = [],
): EvaluationResult {
  const report = parseResearchReport(answer);
  const unverifiedUrls = findUnverifiedUrls(answer, knownUrls);
  if (!report) {
    return {
      passed: false,
      checks: {
        format: false,
        expectedTerms: false,
        sources: false,
        citationsVerified: unverifiedUrls.length === 0,
      },
      unverifiedUrls,
    };
  }

  const searchable = [report.summary, ...report.keyPoints, ...report.uncertainties]
    .join(" ")
    .toLowerCase();
  const checks = {
    format: report.keyPoints.length > 0,
    expectedTerms: testCase.expectedTerms.every((term) =>
      searchable.includes(term.toLowerCase()),
    ),
    sources: !testCase.requiresSources || report.sourceUrls.length > 0,
    citationsVerified: unverifiedUrls.length === 0,
  };

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    unverifiedUrls,
  };
}
