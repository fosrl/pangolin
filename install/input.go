package main

import (
	"errors"
	"fmt"
	"os"
	"strconv"

	"github.com/charmbracelet/huh"
	"golang.org/x/term"
)

// pangolinTheme is the custom theme using brand colors
var pangolinTheme = ThemePangolin()

// isAccessibleMode checks if we should use accessible mode (simple prompts)
// This is true for: non-TTY, TERM=dumb, or ACCESSIBLE env var set
func isAccessibleMode() bool {
	// Check if stdin is not a terminal (piped input, CI, etc.)
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		return true
	}
	// Check for dumb terminal
	if os.Getenv("TERM") == "dumb" {
		return true
	}
	// Check for explicit accessible mode request
	if os.Getenv("ACCESSIBLE") != "" {
		return true
	}
	return false
}

// handleAbort checks if the error is a user abort (Ctrl+C) and exits if so
func handleAbort(err error) {
	if err != nil && errors.Is(err, huh.ErrUserAborted) {
		fmt.Println("\nInstallation cancelled.")
		os.Exit(0)
	}
}

// runField runs a single field with the Pangolin theme, handling accessible mode
func runField(field huh.Field) error {
	if isAccessibleMode() {
		return field.RunAccessible(os.Stdout, os.Stdin)
	}
	form := huh.NewForm(huh.NewGroup(field)).WithTheme(pangolinTheme)
	return form.Run()
}

// nonInteractiveDefault reports the value used for a prompt when running with
// --non-interactive, so the decision stays visible in the install log.
func nonInteractiveDefault(prompt string, value string) {
	fmt.Printf("%s: %s (non-interactive)\n", prompt, value)
}

func readString(prompt string, defaultValue string) string {
	if isNonInteractive() {
		if defaultValue == "" {
			fmt.Printf("Error: no value for %q in non-interactive mode\n", prompt)
			os.Exit(1)
		}
		nonInteractiveDefault(prompt, defaultValue)
		return defaultValue
	}

	var value string

	title := prompt
	if defaultValue != "" {
		title = fmt.Sprintf("%s (default: %s)", prompt, defaultValue)
	}

	input := huh.NewInput().
		Title(title).
		Value(&value)

	// If no default value, this field is required
	if defaultValue == "" {
		input = input.Validate(func(s string) error {
			if s == "" {
				return fmt.Errorf("this field is required")
			}
			return nil
		})
	}

	err := runField(input)
	handleAbort(err)

	if value == "" {
		value = defaultValue
	}

	// Print the answer so it remains visible in terminal history (skip in accessible mode as it already shows)
	if !isAccessibleMode() {
		fmt.Printf("%s: %s\n", prompt, value)
	}

	return value
}

func readPassword(prompt string) string {
	if isNonInteractive() {
		fmt.Printf("Error: no value for %q in non-interactive mode\n", prompt)
		os.Exit(1)
	}

	var value string

	for {
		input := huh.NewInput().
			Title(prompt).
			Value(&value).
			EchoMode(huh.EchoModePassword).
			Validate(func(s string) error {
				if s == "" {
					return fmt.Errorf("password is required")
				}
				return nil
			})

		err := runField(input)
		handleAbort(err)

		if value != "" {
			// Print confirmation without revealing the password
			if !isAccessibleMode() {
				fmt.Printf("%s: %s\n", prompt, "********")
			}
			return value
		}
	}
}

func readBool(prompt string, defaultValue bool) bool {
	if isNonInteractive() {
		nonInteractiveDefault(prompt, strconv.FormatBool(defaultValue))
		return defaultValue
	}

	var value = defaultValue

	confirm := huh.NewConfirm().
		Title(prompt).
		Value(&value).
		Affirmative("Yes").
		Negative("No")

	err := runField(confirm)
	handleAbort(err)

	// Print the answer so it remains visible in terminal history
	if !isAccessibleMode() {
		answer := "No"
		if value {
			answer = "Yes"
		}
		fmt.Printf("%s: %s\n", prompt, answer)
	}

	return value
}

func readBoolNoDefault(prompt string) bool {
	if isNonInteractive() {
		nonInteractiveDefault(prompt, "false")
		return false
	}

	var value bool

	confirm := huh.NewConfirm().
		Title(prompt).
		Value(&value).
		Affirmative("Yes").
		Negative("No")

	err := runField(confirm)
	handleAbort(err)

	// Print the answer so it remains visible in terminal history
	if !isAccessibleMode() {
		answer := "No"
		if value {
			answer = "Yes"
		}
		fmt.Printf("%s: %s\n", prompt, answer)
	}

	return value
}

func readInt(prompt string, defaultValue int) int {
	if isNonInteractive() {
		nonInteractiveDefault(prompt, strconv.Itoa(defaultValue))
		return defaultValue
	}

	var value string

	title := fmt.Sprintf("%s (default: %d)", prompt, defaultValue)

	input := huh.NewInput().
		Title(title).
		Value(&value).
		Validate(func(s string) error {
			if s == "" {
				return nil
			}
			_, err := strconv.Atoi(s)
			if err != nil {
				return fmt.Errorf("please enter a valid number")
			}
			return nil
		})

	err := runField(input)
	handleAbort(err)

	if value == "" {
		// Print the answer so it remains visible in terminal history
		if !isAccessibleMode() {
			fmt.Printf("%s: %d\n", prompt, defaultValue)
		}
		return defaultValue
	}

	result, err := strconv.Atoi(value)
	if err != nil {
		if !isAccessibleMode() {
			fmt.Printf("%s: %d\n", prompt, defaultValue)
		}
		return defaultValue
	}

	// Print the answer so it remains visible in terminal history
	if !isAccessibleMode() {
		fmt.Printf("%s: %d\n", prompt, result)
	}

	return result
}
