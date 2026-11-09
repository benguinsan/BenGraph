/** Excludes convention entry candidates from unimported insights without claiming framework detection or assigning routes. */
export function isConventionEntryPoint(path: string): boolean {
  return /(?:^|\/)app\/(?:.*\/)?(?:page|route|layout|template|loading|error|global-error|not-found|global-not-found|default|sitemap|robots|manifest|icon|apple-icon|opengraph-image|twitter-image)\.[cm]?[jt]sx?$/.test(path)
    || /(?:^|\/)(?:src\/)?pages\/.*\.[jt]sx?$/.test(path)
    || /(?:^|\/)(?:middleware|proxy|instrumentation|instrumentation-client)\.[jt]sx?$/.test(path)
    || /(?:^|\/)(?:[^/]+\.config|\.[^/]*rc)\.[cm]?[jt]s$/.test(path);
}
