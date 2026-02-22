import React from "react";
import { Box, Text } from "ink";

interface StatBoxProps {
  label: string;
  value: string | number;
}

export default function StatBox({ label, value }: StatBoxProps) {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column" width={16}>
      <Text dimColor>{label}</Text>
      <Text bold>{value}</Text>
    </Box>
  );
}
