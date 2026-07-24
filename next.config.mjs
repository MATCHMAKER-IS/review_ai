/** @type {import('next').NextConfig} */
const nextConfig = {
  // pg はネイティブ依存(pg-native)を optional に持つのでバンドルから外す
  serverExternalPackages: ["pg"],
};

export default nextConfig;
