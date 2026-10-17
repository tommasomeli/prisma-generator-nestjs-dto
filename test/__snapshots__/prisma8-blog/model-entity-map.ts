import type { User as UserEntity } from './user/user.entity';
import type { Post as PostEntity } from './post/post.entity';

export interface ModelEntityMap {
    User: UserEntity;
    Post: PostEntity;
}
