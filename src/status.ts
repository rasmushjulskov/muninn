export interface StatusRule {
  indexed: Set<string>;
  supported: RegExp;
  active: RegExp;
  statusMessage: string;
  indexMessage: string;
}

export function indexedStatusFailures(
  name: string,
  file: string,
  header: string,
  rule: StatusRule,
): string[] {
  return [
    ...(rule.supported.test(header) ? [] : [`${name}: ${rule.statusMessage}`]),
    ...(rule.active.test(header) && !rule.indexed.has(file)
      ? [`${name}: ${rule.indexMessage}`]
      : []),
  ];
}
