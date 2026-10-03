# Spec Delta

## MODIFIED Requirements

### Requirement: Bilingual interface
Every user-visible UI string SHALL exist in English and German. The initial language SHALL be the choice saved in the browser, else the browser language when it is German (`de*`) or English (`en*`), else the instance default language (`DEFAULT_LANGUAGE`, English unless configured); a visible switch SHALL change it instantly and persist the choice in the browser. Dates and numbers SHALL be formatted for the active language. API error messages shown to the user SHALL be translated via stable error codes. German texts SHALL use established English loanwords where German-speaking users commonly use them (for example "Sync", not "Abgleich").

#### Scenario: Switch language
- **WHEN** the admin switches from German to English on any page
- **THEN** all labels, empty states, toasts and dialogs appear in English without reload and remain English after reload

#### Scenario: Unsupported browser language
- **WHEN** a browser set to French opens the UI for the first time on an instance with `DEFAULT_LANGUAGE=de`
- **THEN** the UI is shown in German

#### Scenario: English by default
- **WHEN** a browser set to French opens the UI on an instance without `DEFAULT_LANGUAGE`
- **THEN** the UI is shown in English
