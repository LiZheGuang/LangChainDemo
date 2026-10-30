import type { StructuredResearchReport } from "./schemas/research-report.js";

const SECTION_LABELS: Record<string, string> = {
  summary: "结论",
  keyPoints: "关键点",
  sources: "来源",
  uncertainties: "不确定性",
};

const KIND_LABELS: Record<string, string> = { fact: "事实", inference: "推断" };

// A truncated enum value ("fa") renders as nothing until it is complete.
const ITEM_FIELDS: Record<string, (value: string) => string> = {
  claim: (value) => value,
  kind: (value) => (KIND_LABELS[value] ? `（${KIND_LABELS[value]}）` : ""),
  title: (value) => value,
  url: (value) => ` — ${value}`,
  supports: (value) => `\n     支撑：${value}`,
};

function renderItem(item: unknown, marker: string): string {
  if (typeof item === "string") return `  ${marker} ${item}`;
  if (!item || typeof item !== "object") return `  ${marker} `;
  const parts = Object.entries(item).map(([field, value]) =>
    typeof value === "string" ? (ITEM_FIELDS[field]?.(value) ?? "") : "",
  );
  return `  ${marker} ${parts.join("")}`;
}

/**
 * Renders a possibly truncated report in the order its fields arrived, so that
 * every longer prefix of the tool-call arguments only appends to the output.
 * `complete` marks the final arguments, the only point where a trailing empty
 * list is known to stay empty.
 */
export function renderReport(report: object, complete: boolean): string {
  const entries = Object.entries(report).filter(([key]) => key in SECTION_LABELS);
  const lines: string[] = [];
  entries.forEach(([key, value], position) => {
    const label = SECTION_LABELS[key];
    if (typeof value === "string") {
      lines.push(`${label}：${value}`);
      return;
    }
    if (!Array.isArray(value)) return;
    if (value.length === 0) {
      const closed = complete || position < entries.length - 1;
      if (closed) lines.push(`${label}：无`);
      return;
    }
    lines.push(`${label}：`);
    value.forEach((item, index) =>
      lines.push(renderItem(item, key === "sources" ? `${index + 1}.` : "-")),
    );
  });
  return lines.join("\n");
}

/** Prints a report while it streams in, appending only the new text. */
export class LiveReport {
  #printed = "";
  readonly #write: (text: string) => void;

  constructor(write: (text: string) => void) {
    this.#write = write;
  }

  update(report: object, complete: boolean): void {
    const text = renderReport(report, complete);
    if (text.startsWith(this.#printed)) {
      this.#write(text.slice(this.#printed.length));
      this.#printed = text;
    } else if (complete) {
      this.#write(`\n${text}`);
      this.#printed = text;
    }
    // Otherwise a partial parse would rewrite printed text; wait for more input.
  }
}

/** Every piece of report text that may cite a URL, for checking against the thread's sources. */
export function reportText(report: StructuredResearchReport): string {
  return [
    report.summary,
    ...report.keyPoints.map((point) => point.claim),
    ...report.sources.map((source) => source.url),
    ...report.uncertainties,
  ].join("\n");
}
