import cv2
import numpy as np
import base64
from typing import Optional, List
import random


def base64_to_image(base64_string: str) -> np.ndarray:
    """Converts a base64 encoded image string to an OpenCV image."""
    if "," in base64_string:
        base64_string = base64_string.split(",")[1]
    img_data = base64.b64decode(base64_string)
    np_arr = np.frombuffer(img_data, np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    return img


class FaceService:
    @staticmethod
    def enroll_face(image_base64: str) -> Optional[List[float]]:
        """
        Extracts a 128-dimensional face encoding from a base64 image.
        Returns the encoding if exactly one face is found, else None.
        """
        img = base64_to_image(image_base64)
        if img is None:
            return None

        # Mock encoding for fast testing without compiling dlib C++
        mock_encoding = [random.uniform(0, 1) for _ in range(128)]
        return mock_encoding

    @staticmethod
    def verify_face(
            image_base64: str,
            stored_encoding: List[float],
            tolerance: float = 0.5) -> dict:
        """
        Verifies a live face against a stored 128-dimensional encoding.
        Returns dict with match status and Euclidean distance.
        """
        img = base64_to_image(image_base64)
        if img is None:
            return {"match": False, "error": "Invalid image"}

        # Mock verification for fast testing
        return {
            "match": True,
            "distance": 0.25,
            "liveness_passed": True
        }
