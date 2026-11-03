/** Bounded contextual facts, never inference from a comparative or alternative. */
export function fragranceContext(input: string) {
  const editions = new Set<string>();
  const concentrations = new Set<string>(),
    formulations = new Set<string>();
  const negated = new Set<string>();
  let ambiguous = false,
    excluded = 0;
  const text = input
    .slice(0, 4000)
    .toLowerCase()
    .replace(/\beau\s+de\s+parfum\b/g, 'edp')
    .replace(/\beau\s+de\s+toilette\b/g, 'edt')
    .replace(/\beau\s+de\s+cologne\b/g, 'edc');
  const selectedText = text
    .split(/[|;\n]/)
    .slice(0, 64)
    .map((clause) => {
      const comparison =
        /\b(?:above|better\s+than|compared\s+(?:to|with)|versus|vs\.?|unlike|rather\s+than|instead\s+of)\b/i.exec(
          clause,
        );
      const matches = [
        ...clause.matchAll(
          /\b(edp|edt|edc|extrait|intense|elixir|pour homme|pour femme|for him|for her|perfume oil|body mist|body spray|deodorant|attar)\b/g,
        ),
      ];
      const relevant = matches.filter((m) => !comparison || m.index! < comparison.index);
      const versus =
        matches.length > 1 &&
        /\b(?:vs|versus)\b/.test(
          clause.slice(matches[0].index! + matches[0][0].length, matches.at(-1)!.index),
        );
      const alternative =
        versus ||
        (relevant.length > 1 &&
          /\bor\b|\//.test(
            clause.slice(
              relevant[0].index! + relevant[0][0].length,
              relevant.at(-1)!.index,
            ),
          ));
      if (alternative) ambiguous = true;
      let selected = clause;
      for (const m of matches.reverse()) {
        const negative = /\b(?:not(?:\s+(?:a|an))?|no|without|non[- ]?)\s*$/.test(
          clause.slice(0, m.index),
        );
        const comparative = comparison && m.index! >= comparison.index;
        const value = m[1].replace(/ /g, '-');
        if (comparative || negative || alternative) {
          selected =
            selected.slice(0, m.index) +
            ' '.repeat(m[0].length) +
            selected.slice(m.index! + m[0].length);
          excluded++;
          if (negative && !comparative) negated.add(value);
        } else if (/^(edp|edt|edc|extrait)$/.test(value)) concentrations.add(value);
        else if (/^(intense|elixir|pour-homme|pour-femme|for-him|for-her)$/.test(value))
          editions.add(value);
        else formulations.add(value);
      }
      return selected;
    })
    .join('|');
  const contradictions =
    concentrations.size > 1 ||
    formulations.size > 1 ||
    [...concentrations, ...formulations, ...editions].some((v) => negated.has(v));
  return {
    selectedText,
    concentrations: [...concentrations].sort(),
    formulations: [...formulations].sort(),
    editions: [...editions].sort(),
    negated: [...negated].sort(),
    ambiguous,
    contradictions,
    excluded,
  };
}
