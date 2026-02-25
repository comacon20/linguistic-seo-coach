'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type {HistoryPoint} from '@/lib/types';

interface TrendChartProps {
  points: HistoryPoint[];
}

export function TrendChart({points}: TrendChartProps) {
  if (!points.length) {
    return null;
  }

  const data = points.map((point) => ({
    ...point,
    shortDate: formatShortDate(point.analyzedAt),
  }));

  return (
    <div style={{width: '100%', height: 260}}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{top: 10, right: 8, bottom: 10, left: -18}}>
          <CartesianGrid strokeDasharray="4 4" stroke="rgba(47,82,67,0.16)" />
          <XAxis dataKey="shortDate" tick={{fontSize: 12, fill: '#556675'}} axisLine={false} tickLine={false} />
          <YAxis
            yAxisId="left"
            domain={[0, 100]}
            tick={{fontSize: 12, fill: '#556675'}}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{fontSize: 12, fill: '#556675'}}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 12,
              border: '1px solid rgba(189,205,194,0.9)',
              background: 'rgba(255,255,255,0.96)',
            }}
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="score"
            stroke="#12806f"
            strokeWidth={3}
            dot={false}
            name="Leadership score"
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="wordsCount"
            stroke="#d8842f"
            strokeWidth={2}
            dot={false}
            name="Words to practice"
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="seoCount"
            stroke="#5e79b4"
            strokeWidth={2}
            dot={false}
            name="SEO context items"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatShortDate(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }
  return date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}
