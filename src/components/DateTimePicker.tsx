"use client";

import { ChevronDownIcon, CalendarIcon } from "lucide-react";

import { Button } from "@app/components/ui/button";
import { Calendar } from "@app/components/ui/calendar";
import { Input } from "@app/components/ui/input";
import { Label } from "@app/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@app/components/ui/popover";
import { cn } from "@app/lib/cn";
import { ChangeEvent, useEffect, useState } from "react";

export interface DateTimeValue {
  date?: Date;
  time?: string;
}

export interface DateTimePickerProps {
  label?: string;
  value?: DateTimeValue;
  onChange?: (value: DateTimeValue) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  showTime?: boolean;
}

export function DateTimePicker({
  label,
  value,
  onChange,
  placeholder = "Select date & time",
  className,
  disabled = false,
  showTime = true,
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [internalDate, setInternalDate] = useState<Date | undefined>(value?.date);
  const [internalTime, setInternalTime] = useState<string>(value?.time || "");

  // Sync internal state with external value prop
  useEffect(() => {
    setInternalDate(value?.date);
    setInternalTime(value?.time || "");
  }, [value?.date, value?.time]);

  const handleDateChange = (date: Date | undefined) => {
    setInternalDate(date);
    const newValue = { date, time: internalTime };
    onChange?.(newValue);
  };

  const handleTimeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const time = event.target.value;
    setInternalTime(time);
    const newValue = { date: internalDate, time };
    onChange?.(newValue);
  };

const getDisplayText = () => {
    if (!internalDate) return placeholder;
    
    const dateStr = internalDate.toLocaleDateString();
    if (!showTime || !internalTime) return dateStr;
    
    // Parse time and format in local timezone
    const [hours, minutes, seconds] = internalTime.split(':');
    const timeDate = new Date();
    timeDate.setHours(parseInt(hours, 10), parseInt(minutes, 10), parseInt(seconds || '0', 10));
    const timeStr = timeDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    return `${dateStr} ${timeStr}`;
};

  const hasValue = internalDate || (showTime && internalTime);

  return (
    <div className={cn("flex gap-4", className)}>
      <div className="flex flex-col gap-2">
        {label && (
          <Label htmlFor="date-picker">
            {label}
          </Label>
        )}
        <div className="flex gap-2">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                id="date-picker"
                disabled={disabled}
                className={cn(
                  "justify-between font-normal",
                  showTime ? "w-48" : "w-32",
                  !hasValue && "text-muted-foreground"
                )}
              >
                {getDisplayText()}
                <ChevronDownIcon className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto overflow-hidden p-0" align="start">
              {showTime ? (
                <div className="flex">
                  <Calendar
                    mode="single"
                    selected={internalDate}
                    captionLayout="dropdown"
                    onSelect={(date) => {
                      handleDateChange(date);
                      if (!showTime) {
                        setOpen(false);
                      }
                    }}
                    className="flex-grow w-[250px]"
                  />
                  <div className="p-3 border-l">
                    <div className="flex flex-col gap-3">
                      <Label htmlFor="time-input" className="text-sm font-medium">
                        Time
                      </Label>
                      <Input
                        id="time-input"
                        type="time"
                        step="1"
                        value={internalTime}
                        onChange={handleTimeChange}
                        className="bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <Calendar
                  mode="single"
                  selected={internalDate}
                  captionLayout="dropdown"
                  onSelect={(date) => {
                    handleDateChange(date);
                    setOpen(false);
                  }}
                />
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}

export interface DateRangePickerProps {
  startLabel?: string;
  endLabel?: string;
  startValue?: DateTimeValue;
  endValue?: DateTimeValue;
  onStartChange?: (value: DateTimeValue) => void;
  onEndChange?: (value: DateTimeValue) => void;
  onRangeChange?: (start: DateTimeValue, end: DateTimeValue) => void;
  className?: string;
  disabled?: boolean;
  showTime?: boolean;
}

export function DateRangePicker({
//   startLabel = "From",
//   endLabel = "To", 
  startValue,
  endValue,
  onStartChange,
  onEndChange,
  onRangeChange,
  className,
  disabled = false,
  showTime = true,
}: DateRangePickerProps) {
  const handleStartChange = (value: DateTimeValue) => {
    onStartChange?.(value);
    if (onRangeChange && endValue) {
      onRangeChange(value, endValue);
    }
  };

  const handleEndChange = (value: DateTimeValue) => {
    onEndChange?.(value);
    if (onRangeChange && startValue) {
      onRangeChange(startValue, value);
    }
  };

  return (
    <div className={cn("flex gap-4 items-center", className)}>
      <DateTimePicker
        label="Start"
        value={startValue}
        onChange={handleStartChange}
        placeholder="Start date & time"
        disabled={disabled}
        showTime={showTime}
      />
      <DateTimePicker
        label="End"
        value={endValue}
        onChange={handleEndChange}
        placeholder="End date & time"
        disabled={disabled}
        showTime={showTime}
      />
    </div>
  );
}