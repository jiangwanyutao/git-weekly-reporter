const HEADINGS = ['一、上周计划兑现', '二、本周完成', '三、卡住的事', '五、下周计划', '工时：'];

// Only add missing headings; keep model output and any existing section contents intact.
export function completeWorkSections(markdown: string): string {
  const project = /^\s*(?:\*\*)?【[^】\n]+】[^\n]*$/gm;
  const matches = [...markdown.matchAll(project)];
  if (!matches.length) return markdown;
  const prefix = markdown.slice(0, matches[0].index);
  const sections = matches.map((match, index) => {
    let block = markdown.slice(match.index!, matches[index + 1]?.index ?? markdown.length).trimEnd();
    for (let i = 0; i < HEADINGS.length; i++) {
      const heading = HEADINGS[i];
      const findHeading = (value: string) => new RegExp(`^\\s*(?:\\*\\*)?${value}(?:\\*\\*)?\\s*$`, 'm');
      if (findHeading(heading).test(block)) continue;
      let insertion = -1;
      for (const next of HEADINGS.slice(i + 1)) {
        const found = findHeading(next).exec(block);
        if (found && (insertion < 0 || found.index < insertion)) insertion = found.index;
      }
      block = insertion < 0
        ? `${block}\n\n${heading}`
        : `${block.slice(0, insertion).trimEnd()}\n\n${heading}\n\n${block.slice(insertion).trimStart()}`;
    }
    return block;
  });
  return prefix + sections.join('\n\n');
}
