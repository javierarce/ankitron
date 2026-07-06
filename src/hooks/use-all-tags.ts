import { useEffect, useState } from "react";
import { fetchAllTags } from "@/lib/notes";

/**
 * Every tag defined in the collection, sorted, for autocomplete. Fetched once on
 * mount; failures resolve to an empty list so the caller just gets no
 * suggestions rather than an error.
 */
export function useAllTags(): string[] {
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchAllTags()
      .then((all) => {
        if (!cancelled) setTags([...all].sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return tags;
}
