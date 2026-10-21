/** Short repository label (`name` of `owner/name`) for headers. */
export function repositoryShortName(repository: string): string {
  const slash = repository.lastIndexOf("/");
  return slash === -1 ? repository : repository.slice(slash + 1);
}
