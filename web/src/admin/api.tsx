import axios from "axios";
import { authHeaders } from "../shared/auth-fetch";
import { handleUnauthorized } from "@/lib/auth-storage";

const api = axios.create({
  baseURL: "/api", // même serveur que la page
});

// Même identification que les appels fetch (jeton de l'administrateur)
api.interceptors.request.use((config) => {
  for (const [name, value] of Object.entries(authHeaders())) config.headers.set(name, value);
  return config;
});

// Jeton refusé : retour à l'écran de connexion
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) handleUnauthorized();
    return Promise.reject(error);
  }
);

export default api;
