import { StyleSheet } from "@react-pdf/renderer";

export const pdfStyles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 32,
    paddingHorizontal: 28,
    fontSize: 10,
    color: "#000"
  },
  h1: { fontSize: 16, fontWeight: 700 },
  h2: { fontSize: 12, fontWeight: 700 },
  muted: { color: "#444" },
  mono: { fontFamily: "Courier" },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12
  },
  chip: {
    border: "1pt solid #bbb",
    borderRadius: 4,
    paddingVertical: 3,
    paddingHorizontal: 6,
    fontSize: 9
  },

  section: { marginTop: 12 },
  divider: { borderBottom: "1pt solid #ddd", marginTop: 10 },

  grid3: { flexDirection: "row", gap: 10 },
  box: { border: "1pt solid #ddd", borderRadius: 6, padding: 8, flexGrow: 1, flexBasis: 0 },
  label: { fontSize: 8, color: "#555", textTransform: "uppercase", letterSpacing: 0.6 },
  value: { marginTop: 4, fontSize: 10 },

  table: { border: "1pt solid #ddd", borderRadius: 6, overflow: "hidden" },
  thead: { backgroundColor: "#f6f6f6", flexDirection: "row", borderBottom: "1pt solid #ddd" },
  th: { paddingVertical: 6, paddingHorizontal: 8, fontSize: 8, color: "#555", textTransform: "uppercase", letterSpacing: 0.6 },
  tr: { flexDirection: "row", borderBottom: "1pt solid #eee" },
  td: { paddingVertical: 6, paddingHorizontal: 8, fontSize: 9 },

  right: { textAlign: "right" },
  foot: {
    marginTop: 14,
    paddingTop: 8,
    borderTop: "1pt solid #ddd",
    fontSize: 8,
    color: "#555",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12
  }
});

