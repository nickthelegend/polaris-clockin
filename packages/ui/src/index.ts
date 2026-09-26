/**
 * @polaris/ui: the Polaris component library. See README.md for every
 * component with a usage line, and /gallery in either app to see them.
 */

// Helpers
export { cn } from "./lib/cn";
export { formatMoney, formatPercent, formatCompact, moneyParts, currencySymbol, groupTyped } from "./lib/format";
export { useMediaQuery, useControllable, useScrollLock, useFocusTrap, SHEET_QUERY } from "./lib/hooks";
export { IconSlot, IconProvider, ICON_STROKE } from "./lib/icon";

// Primitives
export { Button, IconButton, pressable } from "./primitives/Button";
export type { ButtonProps, ButtonVariant, ButtonSize, IconButtonProps, IconButtonTone } from "./primitives/Button";
export { Pill, Chip, DeltaBadge, Badge } from "./primitives/Pill";
export type { PillProps, PillTone, ChipProps, DeltaBadgeProps, BadgeProps, BadgeTone } from "./primitives/Pill";
export { Avatar, AvatarStack, FlagBadge, pastelFor, initials, PASTEL_BG } from "./primitives/Avatar";
export type { AvatarProps, AvatarStackProps, FlagBadgeProps, FlagCode, Pastel } from "./primitives/Avatar";
export { Card, Tile, SectionHeader, ThemeScope, RowChevron } from "./primitives/Card";
export type { CardProps, TileProps, SectionHeaderProps, ThemeScopeProps, Theme } from "./primitives/Card";
export { SegmentedControl, RangeTabs, Tabs, TabList, Tab, TabPanel } from "./primitives/Segmented";
export type { SegmentedControlProps, SegmentOption, RangeTabsProps, TabsProps, TabProps } from "./primitives/Segmented";
export { Money } from "./primitives/Money";
export type { MoneyProps } from "./primitives/Money";
export { Input, Textarea, Select, Toggle } from "./primitives/Field";
export type { InputProps, TextareaProps, SelectProps, SelectOption, ToggleProps } from "./primitives/Field";
export { Skeleton, SkeletonText, EmptyState } from "./primitives/Feedback";
export type { SkeletonProps, EmptyStateProps } from "./primitives/Feedback";
export { Toaster, toast } from "./primitives/Toast";
export type { ToastInput, ToastTone } from "./primitives/Toast";
export { Table, CellStack } from "./primitives/Table";
export type { TableProps, TableColumn, SortState } from "./primitives/Table";
export { Logo, LogoMark } from "./primitives/Logo";

// Composites
export { StatCard } from "./composites/StatCard";
export type { StatCardProps, StatCardTone } from "./composites/StatCard";
export { StatTile, KeyValueGrid, DetailsList } from "./composites/Stats";
export type { StatTileProps, KeyValueGridProps, DetailsListProps, KeyValue } from "./composites/Stats";
export { TxRow } from "./composites/TxRow";
export type { TxRowProps } from "./composites/TxRow";
export { CardStack } from "./composites/CardStack";
export type { CardStackProps, CardStackAction } from "./composites/CardStack";
export { GradientCard } from "./composites/GradientCard";
export type { GradientCardProps, GradientTone } from "./composites/GradientCard";

// Charts
export { Sparkline } from "./charts/Sparkline";
export type { SparklineProps } from "./charts/Sparkline";
export { LineArea } from "./charts/LineArea";
export type { LineAreaProps, LinePoint } from "./charts/LineArea";
export { CandlestickChart } from "./charts/CandlestickChart";
export type { CandlestickChartProps, Candle } from "./charts/CandlestickChart";
export { DonutChart } from "./charts/DonutChart";
export type { DonutChartProps, DonutSegment } from "./charts/DonutChart";
export { BarChart, BAR_COLORS } from "./charts/BarChart";
export type { BarChartProps, Bar } from "./charts/BarChart";
export { HBarList, HBAR_COLORS } from "./charts/HBarList";
export type { HBarListProps, HBar } from "./charts/HBarList";
export { ProgressLegend } from "./charts/ProgressLegend";
export type { ProgressLegendProps, LegendItem } from "./charts/ProgressLegend";
