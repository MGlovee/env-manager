/** Recommended stable versions per runtime, with rationale. */

export function recommendVersions() {
  return {
    generatedFor: new Date().toISOString().slice(0, 10),
    note: 'Recommendations favor the current LTS / widely-supported stable release. Run env_versions for the live, exact list.',
    jdk: {
      label: 'JDK (Java)',
      distribution: 'Eclipse Temurin (Adoptium)',
      recommended: [
        { version: '21', reason: 'Current LTS with the broadest framework and tooling support.' },
        { version: '17', reason: 'LTS, best choice for legacy projects and older build pipelines.' },
        { version: '25', reason: 'Newest LTS; pick for brand-new projects that can move fast.' },
      ],
    },
    node: {
      label: 'Node.js',
      recommended: [
        { version: 'lts', reason: 'Latest active LTS line is the safe default for most applications.' },
        { version: '22', reason: 'Older LTS for dependencies that lag the newest runtime.' },
      ],
    },
    maven: {
      label: 'Maven',
      recommended: [
        { version: 'latest', reason: 'Latest 3.x; Maven is highly backward compatible.' },
        { version: '3.9', reason: 'The stable 3.9 line, widely used in CI images.' },
      ],
    },
    python: {
      label: 'Python',
      recommended: [
        { version: '3.12', reason: 'Modern, fast, and the baseline most libraries now target.' },
        { version: '3.13', reason: 'Newer stable with improved performance; verify library wheels first.' },
        { version: '3.11', reason: 'Mature line for legacy deployments.' },
      ],
    },
    typicalPaths: {
      windows: 'C:\\Users\\<you>\\.envman\\<tool>\\<version>',
      macos: '~/.envman/<tool>/<version>',
    },
  }
}
