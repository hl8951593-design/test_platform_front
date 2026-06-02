---
name: TestAuto Enterprise
colors:
  surface: '#fcf8fa'
  surface-dim: '#dcd9db'
  surface-bright: '#fcf8fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3f5'
  surface-container: '#f0edef'
  surface-container-high: '#eae7e9'
  surface-container-highest: '#e4e2e4'
  on-surface: '#1b1b1d'
  on-surface-variant: '#45464d'
  inverse-surface: '#303032'
  inverse-on-surface: '#f3f0f2'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#5c5e68'
  on-secondary: '#ffffff'
  secondary-container: '#dedfeb'
  on-secondary-container: '#60626c'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#271901'
  on-tertiary-container: '#98805d'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#e1e2ed'
  secondary-fixed-dim: '#c4c6d1'
  on-secondary-fixed: '#191b24'
  on-secondary-fixed-variant: '#444650'
  tertiary-fixed: '#fcdeb5'
  tertiary-fixed-dim: '#dec29a'
  on-tertiary-fixed: '#271901'
  on-tertiary-fixed-variant: '#574425'
  background: '#fcf8fa'
  on-background: '#1b1b1d'
  surface-variant: '#e4e2e4'
typography:
  display-sm:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  title-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
  title-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  sidebar_width: 240px
  sidebar_collapsed: 64px
  toolbar_height: 56px
---

## Brand & Style
The design system is engineered for high-density information environments, specifically tailored for technical users managing automated testing workflows. The brand personality is **Mature, Professional, and High-Fidelity**. It prioritizes utility over decoration, ensuring that the UI disappears to let data and logs take center stage.

The style is **Corporate / Modern** with a focus on functional precision. It avoids all superfluous elements like gradients, heavy shadows, or illustrations. Instead, it relies on strict alignment, systematic typography, and a cold color palette to evoke a sense of reliability and enterprise-grade stability. The interface should feel like a high-performance tool, similar to an IDE or a financial terminal.

## Colors
The palette is rooted in **Deep Navy (#0f172a)**, used exclusively for structural navigation to anchor the experience. **Professional Blue (#2563eb)** serves as the "Action" color, reserved strictly for primary interactive elements and focus states.

The background system uses a two-tier approach: **Cold Gray (#f8fafc)** for the canvas and **White (#ffffff)** for functional surfaces (cards, panels). Semantic colors for Success, Warning, and Error are used at high-saturation for small-scale elements (icons, chips) and at 10% opacity for larger background fills to ensure legibility without visual fatigue.

## Typography
This design system utilizes **Inter** for all UI elements to maintain a neutral, systematic appearance. Hierarchy is established primarily through weight (SemiBold/Bold) rather than excessive scale jumps, maintaining a compact vertical footprint.

**JetBrains Mono** is specified for all technical output, including log streams, test scripts, and terminal emulators. For high-density tables, `body-sm` (12px) is the preferred size to maximize information density while maintaining AAA accessibility contrast ratios.

## Layout & Spacing
The layout follows a strict **8px spacing system**. The interface is split into three primary zones:
1.  **Global Sidebar:** Fixed to the left, using a Deep Navy background. It is narrow (240px) and can be collapsed to icons only (64px).
2.  **Contextual Toolbar:** A slim 56px top bar containing the project/environment switcher and global search.
3.  **Main Content Area:** A 12-column fluid grid with 24px margins.

Spacing is aggressive to support high density. Elements within cards use 16px padding, while page-level sections use 24px. Tables should use a condensed row height (32px to 40px) to allow for maximum data visibility without scrolling.

## Elevation & Depth
In alignment with the professional aesthetic, this design system avoids soft ambient shadows. Instead, it uses **Low-contrast outlines** and **Tonal layers** to define hierarchy.

-   **Level 0 (Canvas):** Cold Gray (#f8fafc) background.
-   **Level 1 (Surface):** White (#ffffff) cards with a 1px Subtle Slate (#e2e8f0) border. No shadow.
-   **Level 2 (Popovers/Modals):** White background with a very tight, 4px blur, 10% opacity neutral shadow to provide a slight lift from the surface.
-   **Side Panels/Drawers:** These slide in from the right, anchored to the edge, using a 1px left border rather than a shadow to indicate they are part of the structural layout.

## Shapes
The shape language is **Soft (0.25rem)**. This slight rounding prevents the UI from feeling "sharp" or "hostile" like a legacy Windows app, while remaining efficient.

-   **Standard Elements:** Buttons, inputs, and chips use 4px (0.25rem) radius.
-   **Large Containers:** Cards and modals use 8px (0.5rem) radius.
-   **Full Rounding:** Progress bar tracks and "Status Pills" use 9999px (pill-shaped) to distinguish them from interactive buttons.

## Components
-   **Buttons:** Primary buttons use Professional Blue with white text. Secondary buttons use a white fill with a Subtle Slate border.
-   **Data Tables:** The core of the system. Use sticky headers, zebra striping (very subtle 2% gray), and `code-md` for ID columns. Row actions appear on hover or in a dedicated "more" column.
-   **Status Chips:** Small, non-interactive indicators. Success (Green), Warning (Amber), and Error (Red). Use a light tinted background (10% opacity) with a dark text/icon of the same hue.
-   **Input Fields:** Use 1px borders (#e2e8f0). On focus, the border changes to Professional Blue with a 2px blue ring at 20% opacity.
-   **Segmented Controls:** Used for toggling views (e.g., List vs. Grid). They should be styled as a single container with a sliding background highlight for the active state.
-   **Progress Bars:** Thin (4px - 8px) horizontal bars. Use the semantic colors (Success/Action) for the fill and a light gray for the track.
-   **Right-Side Panels:** Used for "Detail Views" of test results. These should be 400px - 600px wide, covering the content area but leaving the sidebar and top toolbar visible.