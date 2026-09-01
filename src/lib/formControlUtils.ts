import type {
    Control,
    FieldValues,
    UseFormSetValue,
    UseFormWatch
} from "react-hook-form";

export function asAnyControl<T extends FieldValues>(
    control: Control<T>
): Control<any> {
    return control as Control<any>;
}

export function asAnySetValue<T extends FieldValues>(
    setValue: UseFormSetValue<T>
): UseFormSetValue<any> {
    return setValue as UseFormSetValue<any>;
}

export function asAnyWatch<T extends FieldValues>(
    watch: UseFormWatch<T>
): UseFormWatch<any> {
    return watch as UseFormWatch<any>;
}
