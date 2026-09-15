import { DatePickerDialog, Host } from "@expo/ui/jetpack-compose";
import { useState } from "react";

import { useEvent } from "../../react/useEvent";
import { colors } from "../../theme";
import { searchDayFromCalendar, searchDayToCalendar } from "./search-calendar-date";

interface CalendarProps {
  readonly value: string;
  readonly onSelect: (day: string) => void;
  readonly onDismiss: () => void;
}

/** Native calendar lives outside the filter popup so opening it cannot dismiss its owner. */
export default function SearchCalendar(props: CalendarProps) {
  const [initialDate] = useState(() => searchDayToCalendar(props.value));
  const select = useEvent((date: Date) => props.onSelect(searchDayFromCalendar(date)));
  return (
    <Host colorScheme="dark" pointerEvents="box-none">
      <DatePickerDialog
        initialDate={initialDate}
        variant="picker"
        showVariantToggle={false}
        color={colors.primary}
        confirmButtonLabel="Select"
        dismissButtonLabel="Cancel"
        onDateSelected={select}
        onDismissRequest={props.onDismiss}
      />
    </Host>
  );
}
