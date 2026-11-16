-- Bản sao cục bộ của lượt truy cập (cùng schema với stream của giảng viên).
-- Dùng làm nguồn dự phòng cho thống kê 24 giờ khi chưa cấu hình R2 SQL.
CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY,
  country TEXT NOT NULL DEFAULT 'XX',
  device TEXT NOT NULL DEFAULT 'desktop',
  time INTEGER NOT NULL,          -- mili-giây (epoch)
  ip TEXT,
  meta TEXT
);
CREATE INDEX IF NOT EXISTS idx_visits_time ON visits(time);
