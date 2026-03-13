"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Image from "next/image";

interface TimeSelectorProps {
  transitTime: number;
  walkTime: number;
  onTransitChange: (val: string) => void;
  onWalkChange: (val: string) => void;
  exceedsLimit: boolean;
}

export function TimeSelector({
  transitTime,
  walkTime,
  onTransitChange,
  onWalkChange,
  exceedsLimit,
}: TimeSelectorProps) {
  return (
    <div className="flex items-center gap-3 px-1">
      {/* Transit */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="w-5 h-5 relative shrink-0 opacity-70">
          <Image src="/public-transport.svg" alt="Kollektiv" fill />
        </div>
        <Select value={`${transitTime} min`} onValueChange={(val) => { if (val) onTransitChange(val); }}>
          <SelectTrigger className="border-none bg-ink-primary/5 rounded-md h-8 w-full focus:ring-ink-primary font-medium text-ink-primary text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-xl border-none shadow-xl">
            <SelectItem value="5 min">5 min</SelectItem>
            <SelectItem value="10 min">10 min</SelectItem>
            <SelectItem value="15 min">15 min</SelectItem>
            <SelectItem value="20 min">20 min</SelectItem>
            <SelectItem value="30 min">30 min</SelectItem>
            <SelectItem value="45 min">45 min</SelectItem>
            <SelectItem value="60 min">60 min</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <span className="text-ink-primary/30 text-base shrink-0">+</span>

      {/* Walk */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="w-4 h-4 relative shrink-0 opacity-70">
          <Image src="/walk.svg" alt="Gange" fill />
        </div>
        <Select value={`${walkTime} min`} onValueChange={(val) => { if (val) onWalkChange(val); }}>
          <SelectTrigger className="border-none bg-ink-primary/5 rounded-lg h-8 w-full focus:ring-ink-primary font-medium text-ink-primary text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-xl border-none shadow-xl">
            <SelectItem value="0 min">0 min</SelectItem>
            <SelectItem value="5 min">5 min</SelectItem>
            <SelectItem value="10 min">10 min</SelectItem>
            <SelectItem value="15 min">15 min</SelectItem>
            <SelectItem value="20 min">20 min</SelectItem>
            <SelectItem value="30 min">30 min</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <span className="text-ink-primary/30 text-base shrink-0">=</span>

      {/* Total */}
      <div className={`shrink-0 font-bold text-sm ${
        exceedsLimit
          ? "text-red-500"
          : "text-ink-primary"
      }`}>
        {transitTime + walkTime} min
      </div>
    </div>
  );
}
