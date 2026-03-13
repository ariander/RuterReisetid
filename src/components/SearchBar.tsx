"use client";

import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Search } from "lucide-react";

interface SearchBarProps {
  onSelect: (location: { lat: number; lng: number; name: string }) => void;
}

export function SearchBar({ onSelect }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const suppressSearch = useRef(false);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    if (suppressSearch.current) {
      suppressSearch.current = false;
      return;
    }

    if (query.length < 3) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    debounceTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.entur.io/geocoder/v1/autocomplete?text=${encodeURIComponent(
            query
          )}&lang=no`
        );
        const data = await res.json();
        setResults(data.features || []);
        setIsOpen(data.features?.length > 0);
      } catch (err) {
        console.error("Search error:", err);
      }
    }, 300);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative flex-1" ref={containerRef}>
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-primary opacity-50">
          <Search size={16} />
        </div>
        <Input
          ref={inputRef}
          placeholder="Finn sted"
          className="h-10 pl-9 pr-3 bg-transparent border-none shadow-none rounded-xl text-sm focus-visible:ring-0 placeholder:text-ink-primary/40"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsOpen(results.length > 0)}
        />
      </div>

      {isOpen && (
        <Card className="absolute top-full gap-1 mt-0 w-full bg-white shadow-2xl rounded-lg overflow-hidden border-none py-3 max-h-96 overflow-y-auto z-50">
          {results.map((res: any) => (
            <button
              key={res.properties.id}
              className="w-full px-4 py-2 text-left hover:bg-slate-50 transition-colors flex flex-col gap-0.5"
              onClick={() => {
                const [lng, lat] = res.geometry.coordinates;
                onSelect({ lat, lng, name: res.properties.name });
                suppressSearch.current = true;
                setQuery(res.properties.name);
                setIsOpen(false);
                setResults([]);
                inputRef.current?.blur();
              }}
            >
              <span className="font-medium text-ink-primary text-sm">
                {res.properties.name}
              </span>
              <span className="text-xs text-ink-primary/60">
                {res.properties.locality || res.properties.county}
              </span>
            </button>
          ))}
        </Card>
      )}
    </div>
  );
}
