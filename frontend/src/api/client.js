import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

const client = axios.create({
  baseURL: `${API_BASE_URL}/api`,
});

// Attach the JWT (if present) to every outgoing request
client.interceptors.request.use((config) => {
  const token = localStorage.getItem("cf_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// If the token is invalid/expired, bounce back to login
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("cf_token");
      localStorage.removeItem("cf_user");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export default client;
