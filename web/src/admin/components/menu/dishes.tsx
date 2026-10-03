import api from '../../api';
import type { Currency } from '@/lib/bill';

export interface Dish {
  id: number;
  name: string;
  description?: string | null;
  price: number | string;
  /** Devise du restaurant (la même pour tout le menu) */
  currency?: Currency;
  category?: string | null;
  images?: string[] | null;
  is_available: boolean;
  average_rating?: number;
  total_ratings?: number;
}

export const listDishes = () => api.get<Dish[]>('/dishes');

export const getDish = (id: number) => api.get<Dish>(`/dishes/${id}`);

export const createDish = (data: FormData) => api.post<Dish>('/dishes', data, {
  headers: { 'Content-Type': 'multipart/form-data' }
});

export const updateDish = (id: number, data: FormData) => api.put<Dish>(`/dishes/${id}`, data, {
  headers: { 'Content-Type': 'multipart/form-data' }
});

/** Change seulement la disponibilité d'un plat (rien d'autre n'est modifié) */
export const setDishAvailability = (id: number, isAvailable: boolean) => {
  const data = new FormData();
  data.append('is_available', isAvailable ? '1' : '0');
  return updateDish(id, data);
};

export const deleteDish = (id: number) => api.delete(`/dishes/${id}`);

export const deleteImage = (imageUrl: string) => api.delete(`/delete-image`, {
  data: { image_url: imageUrl }
});

// Rating functions
export const addRating = (data: { dish_id: number; rating: number; comment?: string }) =>
  api.post('/ratings', data);

export const getDishRatings = (dishId: number) =>
  api.get(`/dishes/${dishId}/ratings`);

export const getAllRatings = () =>
  api.get('/ratings');
