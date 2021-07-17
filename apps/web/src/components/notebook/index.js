import React from "react";
import { Flex, Text } from "rebass";
import ListItem from "../list-item";
import { store } from "../../stores/notebook-store";
import { store as appStore } from "../../stores/app-store";
import { showItemDeletedToast, showUnpinnedToast } from "../../common/toasts";
import { db } from "../../common/db";
import * as Icon from "../icons";
import { hashNavigate, navigate } from "../../navigation";
import { getTotalNotes } from "../../common";
import IconTag from "../icon-tag";

class Notebook extends React.Component {
  shouldComponentUpdate(nextProps) {
    const prevItem = this.props.item;
    const nextItem = nextProps.item;
    return (
      prevItem.pinned !== nextItem.pinned ||
      prevItem.title !== nextItem.title ||
      prevItem.description !== nextItem.description ||
      prevItem.topics.length !== nextItem.topics.length
    );
  }
  render() {
    const { item, index } = this.props;
    const notebook = item;

    return (
      <ListItem
        selectable
        item={notebook}
        onClick={() => {
          navigate(`/notebooks/${notebook.id}`);
        }}
        title={notebook.title}
        body={notebook.description}
        index={index}
        menu={{ items: menuItems, extraData: { notebook } }}
        footer={
          <>
            {notebook?.topics && (
              <Flex mb={1}>
                {notebook?.topics.slice(0, 3).map((topic) => (
                  <IconTag
                    key={topic.id}
                    text={topic.title}
                    icon={Icon.Topic}
                    onClick={(e) => {
                      navigate(`/notebooks/${notebook.id}/${topic.id}`);
                    }}
                  />
                ))}
              </Flex>
            )}
            <Flex
              sx={{ fontSize: "subBody", color: "fontTertiary" }}
              alignItems="center"
            >
              {notebook.pinned && (
                <Icon.PinFilled color="primary" size={13} sx={{ mr: 1 }} />
              )}
              {new Date(notebook.dateCreated).toLocaleDateString("en", {
                month: "long",
                day: "2-digit",
                year: "numeric",
              })}
              <Text as="span" mx={1}>
                •
              </Text>
              <Text>{getTotalNotes(notebook)} Notes</Text>
            </Flex>
          </>
        }
      />
    );
  }
}
export default Notebook;

const pin = async (notebook) => {
  await store.pin(notebook);
  if (notebook.pinned) showUnpinnedToast(notebook.id, "notebook");
};

const menuItems = [
  {
    title: () => "Edit",
    icon: Icon.NotebookEdit,
    onClick: ({ notebook }) => hashNavigate(`/notebooks/${notebook.id}/edit`),
  },
  {
    key: "pinnotebook",
    icon: Icon.Pin,
    title: ({ notebook }) => (notebook.pinned ? "Unpin" : "Pin"),
    onClick: ({ notebook }) => pin(notebook),
  },
  {
    key: "shortcut",
    icon: Icon.Shortcut,
    title: ({ notebook }) =>
      db.settings.isPinned(notebook.id) ? "Remove shortcut" : "Create shortcut",
    onClick: ({ notebook }) => appStore.pinItemToMenu(notebook),
  },
  {
    title: () => "Move to trash",
    color: "red",
    icon: Icon.Trash,
    onClick: async ({ notebook }) => {
      await store
        .delete(notebook.id)
        .then(() => showItemDeletedToast(notebook));
    },
  },
];
