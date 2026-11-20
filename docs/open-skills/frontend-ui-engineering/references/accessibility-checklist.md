# Accessibility Verification Checklist

Use the project’s existing accessibility tooling first. Verify the changed user flow, not only isolated markup.

- [ ] Semantic elements and landmark structure are appropriate.
- [ ] Every interactive control has an accessible name and clear focus state.
- [ ] The full flow works by keyboard in a logical order with no focus trap.
- [ ] Dialogs, menus, errors, and dynamic updates expose correct roles/states and focus behavior.
- [ ] Form labels, instructions, validation messages, and error recovery are understandable.
- [ ] Text and meaningful UI states meet the project’s contrast requirements.
- [ ] Content remains usable at zoom and across supported viewport sizes.
- [ ] Motion respects reduced-motion preferences where applicable.
- [ ] Automated accessibility checks run when available.
- [ ] A real-browser/manual pass covers the primary flow; automated checks alone are not sufficient.

Report the browser/tool used, flow tested, violations found, and any unsupported checks.
