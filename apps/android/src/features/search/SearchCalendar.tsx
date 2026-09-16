import { DatePickerDialog, Host } from "@expo/ui/jetpack-compose";
import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import { colors } from "../../theme";
import { searchDayFromCalendar, searchDayToCalendar } from "./search-calendar-date";

interface CalendarProps {
  readonly onDismiss: () => void;
  readonly onSelect: (day: string) => void;
  readonly value: string;
}

/** Native calendar lives outside the filter popup so opening it cannot dismiss its owner. */
export default function SearchCalendar(props: CalendarProps) {
  const initialDate = useConstant(() => searchDayToCalendar(props.value));
  const select = useEvent((date: Date) => {
    props.onSelect(searchDayFromCalendar(date));
  });
  return (
    <Host colorScheme="dark" pointerEvents="box-none">
      <DatePickerDialog
        color={colors.primary}
        confirmButtonLabel="Select"
        dismissButtonLabel="Cancel"
        initialDate={initialDate}
        onDateSelected={select}
        onDismissRequest={props.onDismiss}
        showVariantToggle={false}
        variant="picker"
      />
    </Host>
  );
}
